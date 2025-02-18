import {commandOptions} from './commands';
import {emojis, md} from './md';
import {regexpEscape} from './util';

export const maxNumMatches = 20;

export function autocomplete(category, params) {
  return autocomplete[category] ? autocomplete[category](params) : [];
}

export function fillIn(middle, params) {
  if (middle && middle.hasOwnProperty('val')) middle = middle.val; // Autocomplete option

  const cursorPos = params.append ? params.value.length : params.cursorPos;
  let [before, after] = [params.value.substring(0, cursorPos), params.value.substring(cursorPos)];
  if (typeof middle == 'undefined') return {before, middle: '', after};

  if (params.append) {
    before = before.replace(/[ ]$/, '');
    if (before.length) middle = ' ' + middle;
  }

  if (params.padBefore) {
    before = before.replace(/[ ]$/, '');
    if (before.length) middle = ' ' + middle;
  }

  if (params.padAfter) {
    after = after.replace(/^[ ]/, '');
    middle = middle + ' ';
  }

  if (params.replace) {
    before = before.replace(/\S*\s?$/, '');
  }

  return {before, middle, after};
}

export function calculateAutocompleteOptions(str, splitValueAt, {conversation, user}) {
  let key = '';
  let afterKey = '';

  const before = str.substring(0, splitValueAt).replace(/(\S)(\S*)$/, (a, b, c) => {
    key = b;
    afterKey = c;
    return '';
  });

  const autocompleteCategory =
      key == ':' && afterKey.length ? 'emojis'
    : key == '/' && !before.length  ? 'commands'
    : key == '@' && afterKey.length ? 'nicks'
    : key == '#' || key == '&'      ? 'conversations'
    :                                 'none';

  const opts = autocomplete(autocompleteCategory, {conversation, query: key + afterKey, user});
  if (opts.length) opts.unshift({autocompleteCategory, val: key + afterKey});
  return opts;
}

autocomplete.commands = ({query}) => commandOptions({query});

autocomplete.conversations = ({conversation, query, user}) => {
  const connection = user.findConversation({connection_id: conversation.connection_id});
  const conversations = connection ? connection.conversations.toArray() : user.conversations();
  const opts = [];

  for (let i = 0; i < conversations.length; i++) {
    if (conversations[i].name.toLowerCase().indexOf(query) == -1) continue;
    opts.push({text: conversations[i].name, val: conversations[i].conversation_id});
    if (opts.length >= maxNumMatches) break;
  }

  return opts;
};

autocomplete.emojis = ({query}) => {
  const opts = [];

  [':', '_'].map(p => p + query.slice(1, 2)).forEach(group => {
    const emojiList = emojis(group, 'group');
    for (let i = 0; i < emojiList.length; i++) {
      if (emojiList[i].shortname.indexOf(query) >= 0) opts.push({val: emojiList[i].emoji, text: md(emojiList[i].emoji)});
      if (opts.length >= maxNumMatches) break;
    }
  });

  return opts;
};

autocomplete.nicks = ({conversation, query}) => {
  const re = new RegExp('^' + regexpEscape(query.slice(1)), 'i');
  const opts = [];

  for (let participant of conversation.participants.toArray()) {
    if (opts.length >= maxNumMatches) break;
    if (participant.nick.match(re)) opts.push({val: participant.nick});
  }

  return opts;
};
