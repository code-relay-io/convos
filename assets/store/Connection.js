import ConnectionURL from '../js/ConnectionURL';
import Conversation from './Conversation';
import SortedMap from '../js/SortedMap';
import {extractErrorMessage} from '../js/util';
import {api} from '../js/Api';
import {modeMoniker} from '../js/constants';
import {notify} from '../js/Notify';

const sortConversations = (a, b) => {
  return (a.is('private') - b.is('private')) || a.name.localeCompare(b.name);
};

export default class Connection extends Conversation {
  constructor(params) {
    super(params);

    this.prop('ro', 'conversations', new SortedMap([], {sorter: sortConversations}));
    this.prop('rw', 'on_connect_commands', params.on_connect_commands || []);
    this.prop('rw', 'state', params.state || 'queued');
    this.prop('rw', 'wanted_state', params.wanted_state || 'connected');
    this.prop('rw', 'url', typeof params.url == 'string' ? new ConnectionURL(params.url) : params.url || new ConnectionURL('irc://localhost'));

    const nick = this.url.searchParams.get('nick') || 'guest';
    this.prop('rw', 'nick', nick);
    this.prop('rw', 'real_host', this.url.hostname);
    this.prop('rw', 'server_op', false);

    this.participants.add((params.service_accounts || []).map(nick => ({nick})).concat({nick}));
    if (params.me) this.wsEventMe(params.me);
  }

  ensureConversation(params) {
    let conversation = this.conversations.get(params.conversation_id);
    if (conversation) return conversation.update(params);

    conversation = new Conversation({...params, connection_id: this.connection_id});
    conversation.on('message', params => this.emit('message', params));
    conversation.on('update', () => this.update({conversations: true}));
    this._addDefaultParticipants(conversation);
    this.conversations.set(conversation.conversation_id, conversation);
    this.update({conversations: true});
    this.emit('conversationadd', conversation);
    return conversation;
  }

  findConversation(params) {
    return this.conversations.get(params.conversation_id) || null;
  }

  is(status) {
    return this.state == status || super.is(status);
  }

  removeConversation(params) {
    const conversation = this.findConversation(params) || params;
    this.conversations.delete(conversation.conversation_id);
    this.emit('conversationremove', conversation);
    return this.update({conversations: true});
  }

  send(message) {
    if (typeof message == 'string') message = {message};

    const re = new RegExp('^' + this.participants.toArray().map(p => p.id).join('|') + ':', 'i');
    if (message.message.indexOf('/') != 0 && !message.message.match(re)) {
      message.message = '/quote ' + message.message;
    }

    return super.send(message);
  }

  toForm() {
    const urlParams = this.url.searchParams;
    return {
      local_address: urlParams.get('local_address') || '',
      nick: urlParams.get('nick') || this.nick,
      on_connect_commands: this.on_connect_commands.join('\n'),
      password: this.url.password || '',
      realname: urlParams.get('realname') || '',
      sasl: urlParams.get('sasl') || 'none',
      server: this.url.host,
      tls: urlParams.get('tls') == '1' ? true : false,
      tls_verify: urlParams.get('tls_verify') == '1' ? true : false,
      username: this.url.username || '',
      want_to_be_connected: this.wanted_state == 'disconnected' ? false : true,
    };
  }

  toSaveOperationParams(fields) {
    const url = new ConnectionURL('irc://localhost:6667');
    const urlParams = url.searchParams;

    const server = fields.server || '';
    url.host = server.match(/:\d+$/) ? server : server + ':6667';
    urlParams.append('sasl', fields.sasl || 'none');
    urlParams.append('tls', fields.tls ? '1' : '0');

    if (fields.password) url.password = fields.password;
    if (fields.username) url.username = fields.username;
    if (fields.local_address) urlParams.append('local_address', fields.local_address.trim());
    if (fields.nick) urlParams.append('nick', fields.nick.trim());
    if (fields.realname) urlParams.append('realname', fields.realname.trim());
    if (fields.tls && fields.tls_verify) urlParams.append('tls_verify', '1');

    const params = {};
    params.on_connect_commands = typeof fields.on_connect_commands == 'undefined' ? this.on_connect_commands : fields.on_connect_commands.split(/\n\r?/);
    params.on_connect_commands = params.on_connect_commands.filter(cmd => cmd.length);
    params.wanted_state = !fields.hasOwnProperty('want_to_be_connected') ? this.wanted_state : fields.want_to_be_connected ? 'connected' : 'disconnected';
    if (this.connection_id) params.connection_id = this.connection_id;
    if (server) params.url = url.toString();

    return params;
  }

  update(params) {
    if (params.url && typeof params.url == 'string') params.url = new ConnectionURL(params.url);
    return super.update(params);
  }

  wsEventConnection(params) {
    this.update({state: params.state});
    this.addMessages(params.message
        ? {message: 'Connection state changed to %1: %2', vars: [params.state, params.message]}
        : {message: 'Connection state changed to %1.', vars: [params.state]}
      );
  }

  wsEventFrozen(params) {
    const existing = this.findConversation(params);
    const wasFrozen = existing && existing.frozen;
    const conversation = this.ensureConversation(params);
    conversation.participants.add({nick: this.nick, me: true});
    if (wasFrozen && !params.frozen) existing.addMessages({message: 'Connected.', vars: []});
    if (params.frozen && conversation.is('pending')) notify.show(params.frozen, {title: params.name});
  }

  wsEventMe(params) {
    if (params.nick) this.wsEventNickChange(params);
    if (params.server_op) this.addMessages({message: 'You are an IRC operator.', vars: [], highlight: true});
    if (params.real_host) this.participants.add({nick: params.real_host});
    this.update(params);
  }

  wsEventMessage(params) {
    params.yourself = params.from == this.nick;
    return params.conversation_id ? this.ensureConversation(params).addMessages(params) : this.addMessages(params);
  }

  wsEventNickChange(params) {
    const nickChangeParams = {old_nick: params.old_nick || this.nick, new_nick: params.new_nick || params.nick, type: params.type};
    if (params.old_nick == this.nick) nickChangeParams.me = true;
    super.wsEventNickChange(nickChangeParams);
    this.conversations.forEach(conversation => conversation.wsEventNickChange(nickChangeParams));
  }

  wsEventError(params) {
    const msg = {
      message: extractErrorMessage(params) || params.frozen || 'Unknown error from %1.',
      sent: params,
      type: 'error',
      vars: params.command || [params.message],
    };

    // Could not join
    const joinCommand = (params.message || '').match(/^\/j(oin)? (\S+)/);
    if (joinCommand) return this.ensureConversation({...params, conversation_id: joinCommand[2]});

    // Generic errors
    const conversation = (params.conversation_id && params.frozen) ? this.ensureConversation(params) : (this.findConversation(params) || this);
    console.error(conversation.conversation_id, msg);
    conversation.addMessages(msg);
  }

  wsEventJoin(params) {
    const conversation = this.ensureConversation({connection_id: params.connection_id, conversation_id: params.conversation_id});
    const nick = params.nick || this.nick;
    if (nick != this.nick && !params.silent) conversation.addMessages({message: '%1 joined.', vars: [nick]});
    conversation.participants.add({nick});
  }

  wsEventPart(params) {
    if (params.nick == this.nick) return this.removeConversation(params);
    if (params.conversation_id) return;
    this.conversations.forEach(conversation => conversation.wsEventPart(params));
  }

  wsEventQuit(params) {
    this.wsEventPart(params);
  }

  wsEventSentJoin(params) {
    this.wsEventJoin(params);
  }

  wsEventSentList(params) {
    const args = params.args || '/*/';
    this.addMessages(params.done
      ? {message: 'Found %1 of %2 conversations from %3.', vars: [params.conversations.length, params.n_conversations, args]}
      : {message: 'Found %1 of %2 conversations from %3, but conversations are still loading.', vars: [params.conversations.length, params.n_conversations, args]}
    );
  }

  wsEventSentMode(params) {
    const conversation = this.findConversation(params);
    return conversation ? conversation.wsEventMode(params)
      : this.addMessages({message: '%1 received mode %2.', vars: [params.target, params.mode]});
  }

  wsEventSentQuery(params) {
    this.ensureConversation(params);
  }

  wsEventSentWhois(params) {
    let message = '%1 (%2@%3, %4)';
    let vars = [params.nick, params.user, params.host, params.name];

    const channels = Object.keys(params.channels).sort().map(name => (modeMoniker[params.channels[name].mode] || '') + name);
    params.channels = channels;

    if (params.idle_for && channels.length) {
      message += ' has been idle for %5s in %6.';
      vars.push(params.idle_for);
      vars.push(channels.join(', '));
    }
    else if (params.idle_for && !channels.length) {
      message += 'has been idle for %5s, and is not in any channels.';
      vars.push(params.idle_for);
    }
    else if (channels.length) {
      message += ' is active in %5.';
      vars.push(channels.join(', '));
    }
    else {
      message += ' is not in any channels.';
    }

    const conversation = this.findConversation(params) || this;
    conversation.addMessages({message, vars, sent: params});
  }

  wsEventSentNames() { } // Ignore this event

  _addDefaultParticipants(conversation) {
    const participants = [{nick: this.nick, me: true}];
    if (conversation.is('private')) participants.push({nick: conversation.name});
    conversation.participants.add(participants);
  }

  _addOperations() {
    this.prop('ro', 'markAsReadOp', api('/api', 'markConnectionAsRead'));
    this.prop('ro', 'messagesOp', api('/api', 'connectionMessages'));
  }

  _calculateFrozen() {
    switch (this.state) {
      case 'connected': return '';
      case 'disconnected': return 'Disconnected.';
      case 'unreachable': return 'Unreachable.';
      default: return 'Connecting...';
    }
  }
}
