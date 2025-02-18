#!perl
use lib '.';
use t::Helper;

$ENV{CONVOS_BACKEND} = 'Convos::Core::Backend';
$ENV{CONVOS_DEFAULT_CONNECTION} ||= 'irc://localhost:6123/%23convos';
$ENV{CONVOS_OPEN_TO_PUBLIC} = 1;

my $t = t::Helper->t;
is $t->app->core->ready, 1, 'ready';

$t->get_ok('/api/user')->status_is(401)->json_is('/errors/0/message', 'Need to log in first.');
$t->delete_ok('/api/user/superman@example.com')->status_is(401)
  ->json_is('/errors/0/message', 'Need to log in first.');
$t->post_ok('/api/user/superman@example.com', json => {})->status_is(401)
  ->json_is('/errors/0/message', 'Need to log in first.')->json_is('/errors/0/path', '/');

$t->post_ok('/api/user/register',
  json => {email => 'superman@example.com  ', password => '  longenough '})->status_is(200)
  ->json_is('/email', 'superman@example.com')->json_like('/registered', qr/^[\d-]+T[\d:]+Z$/);
my $registered = $t->tx->res->json->{registered};

$t->post_ok('/api/user/superman@example.com', json => {})->status_is(200);

$t->get_ok('/api/user')->status_is(200);
is_deeply(
  $t->tx->res->json,
  {
    email              => 'superman@example.com',
    forced_connection  => false,
    default_connection => 'irc://localhost:6123/%23convos',
    highlight_keywords => [],
    registered         => $registered,
    roles              => ['admin'],
    uid                => 1,
    unread             => 0,
    video_service      => 'https://meet.jit.si/',
  },
  'user object'
);

$t->post_ok('/api/user/superman@example.com',
  json => {highlight_keywords => [' ', '-', '.', '  ,', '    ', 'foo ']})->status_is(200);
$t->get_ok('/api/user')->status_is(200)->json_is('/email', 'superman@example.com')
  ->json_is('/highlight_keywords', ['foo']);

my $user = $t->app->core->get_user('superman@example.com');
$user->unread(4);

$user->connection({name => 'localhost', protocol => 'irc'})->conversation({name => '#convos'})
  ->unread(42);
$t->get_ok('/api/user?connections=true&conversations=true')->status_is(200);
cmp_deeply(
  $t->tx->res->json,
  superhashof({
    email         => 'superman@example.com',
    conversations => [{
      connection_id   => 'irc-localhost',
      conversation_id => '#convos',
      frozen          => 'Not connected.',
      name            => '#convos',
      topic           => '',
      unread          => 42,
    }],
    connections => [{
      connection_id       => 'irc-localhost',
      me                  => {authenticated => false, capabilities => {}, nick => 'superman'},
      name                => 'localhost',
      on_connect_commands => [],
      protocol            => 'irc',
      service_accounts    => [qw(chanserv nickserv)],
      state               => re(qr{disconnected|queued}),
      url                 => 'irc://localhost:6123/%23convos?nick=superman&tls=1',
      wanted_state        => 'connected',
    }],
  }),
  'user.json'
);

$t->post_ok('/api/notifications/read')->status_is(200);

$t->delete_ok('/api/user/superman@example.com')->status_is(400)
  ->json_is('/errors/0/message', 'You are the only user left.');

$t->get_ok('/api/user/logout')->status_is(200);
$t->get_ok('/api/user')->status_is(401);

$t->app->core->ready(0);
$t->get_ok('/api/user')->status_is(503)->json_is('/errors/0/message', 'Backend is starting.');

$t->get_ok('/chat')->status_is(503)->element_exists('a.btn[href="/"]')
  ->text_is('a.btn[href="/"]', 'Try again')->text_is('title', 'Backend is starting (503) - Convos')
  ->text_is('h1',              'Backend is starting (503)');

done_testing;
