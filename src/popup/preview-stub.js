// Throwaway harness: fakes the chrome.* surfaces the popup touches so the page
// can be rendered in a plain browser tab for visual review. Not loaded by the
// real extension.
const now = Date.now();
const iso = (mins) => new Date(now - mins * 60000).toISOString();

const me = 'kaid_self';

const chessLog = [
  ['kaid_buddy', 'Ada Lovelace', 'KANMCHESS invite w'],
  ['kaid_self', 'Colin', 'KANMCHESS accept'],
  ['kaid_buddy', 'Ada Lovelace', String.raw`\[chess\] e2e4`],
  ['kaid_self', 'Colin', String.raw`\[chess\] e7e5`],
  ['kaid_buddy', 'Ada Lovelace', 'KANMCHESS g1f3'],
].map(([kaid, nickname, content], i) => ({
  key: `c${i}`,
  date: new Date(Date.now() - (10 - i) * 60000).toISOString(),
  content,
  author: { kaid, nickname, avatarSrc: null },
}));

const messages = [
  {
    key: 'm1',
    date: iso(50),
    content: 'hey, does this thing work?',
    author: { kaid: 'kaid_buddy', nickname: 'Ada Lovelace', avatarSrc: null },
  },
  {
    key: 'm2',
    date: iso(48),
    content: 'seems to, yeah',
    author: { kaid: me, nickname: 'Colin', avatarSrc: null },
  },
  {
    key: 'm3',
    date: iso(46),
    content: 'nice. long enough message to check how the bubble wraps onto a second line',
    author: { kaid: 'kaid_buddy', nickname: 'Ada Lovelace', avatarSrc: null },
  },
  {
    key: 'm4',
    date: iso(44),
    content: 'good, that is the awkward one',
    author: { kaid: me, nickname: 'Colin', avatarSrc: null },
  },
  {
    key: 'm5',
    expandKey: 'xk_m5',
    date: iso(4),
    content: 'testing testing',
    author: { kaid: 'kaid_buddy', nickname: 'Ada Lovelace', avatarSrc: null },
  },
  {
    key: 'm6',
    date: iso(3),
    content: 'and a second one right after, to check grouping',
    author: { kaid: 'kaid_buddy', nickname: 'Ada Lovelace', avatarSrc: null },
  },
];

const state = {
  signedIn: true,
  loaded: true,
  unreadCount: 3,
  hasMore: true,
  cursor: 'abc',
  lastSync: now - 12000,
  lastError: null,
  theme: 'system',
  accent: 'violet',
  soundEnabled: true,
  soundName: 'chime',
  volume: 0.6,
  soundOnNotifications: true,
  soundOnChat: true,
  pollSeconds: 5,
  autoMessages: true,
  autoMarkRead: true,
  hideChatNotifications: true,
  hideChatOnSite: false,
  clearChessOnEnd: true,
  updateDismissedVersion: null,
  announcedKeys: [],
  activeChatId: null,
  shareCodeInComment: false,
  updateAvailable: '1.1.0',
  updateCheckedAt: now,
  updateError: null,
  updateSource: 'raw.githubusercontent.com',
  updateRemoteVersion: '1.1.0',
  profileFetchedAt: now,
  profile: { kaid: me, nickname: 'Colin', username: 'colinb', points: 184320, avatarSrc: null },

  chats: [
    {
      id: '6586620957786112:HTD3PN',
      programId: '6586620957786112',
      roomId: 'HTD3PN',
      name: 'Homework Help',
      customTitle: '',
      roomKey: 'room1',
      expandKey: 'ag5zfmtoYW4tYWNhZGVteXI',
      title: 'Particle Fountain',
      url: 'https://www.khanacademy.org/computer-programming/x/6586620957786112',
      code: 'KA-1SURFW8R30G-HTD3PND',
      messages: [...messages, ...chessLog],
      members: [{ kaid: 'kaid_buddy', nickname: 'Ada Lovelace', avatarSrc: null }],
      lastSeenKey: 'm4',
      unread: 1,
      error: null,
    },
    {
      id: '6586620957786112:9QW2ZK',
      programId: '6586620957786112',
      roomId: '9QW2ZK',
      name: '',
      customTitle: 'My nickname for it',
      roomKey: 'room2',
      expandKey: '',
      title: 'Particle Fountain',
      url: null,
      code: 'KA-1SURFW8R30G-9QW2ZKM',
      messages: [],
      members: [],
      lastSeenKey: null,
      unread: 0,
      error: null,
    },
    {
      id: '1234567890123456:B4XM7T',
      programId: '1234567890123456',
      roomId: 'B4XM7T',
      name: 'Snake chat',
      customTitle: '',
      roomKey: 'room3',
      expandKey: '',
      title: 'Snake Game',
      url: null,
      code: 'KA-C5M8NQ6ITC-B4XM7TR',
      messages: [],
      members: [{ kaid: 'kaid_other', nickname: 'Grace H.', avatarSrc: null }],
      lastSeenKey: null,
      unread: 0,
      error: null,
    },
  ],

  notifications: [
    {
      __typename: 'ResponseFeedbackNotification',
      brandNew: true,
      date: iso(2),
      url: '/computer-programming/x/6586620957786112?qa_expand_key=xk_m5',
      urlsafeKey: 'a',
      authorNickname: 'Ada Lovelace',
      authorAvatarUrl: null,
      feedbackType: 'REPLY',
      content: 'Nice work on this! Did you try using **recursion** for the tree part?',
      focusTranslatedTitle: 'Binary Trees',
    },
    {
      __typename: 'ProgramFeedbackNotification',
      brandNew: true,
      date: iso(26),
      url: '/cs/i/456',
      urlsafeKey: 'b',
      authorNickname: 'Grace H.',
      authorAvatarSrc: null,
      feedbackType: 'COMMENT',
      translatedScratchpadTitle: 'Particle Fountain',
      content: 'How did you get the particles to fade out so smoothly?',
    },
    {
      __typename: 'BadgeNotification',
      brandNew: true,
      date: iso(90),
      url: '/badges',
      urlsafeKey: 'c',
      badgeName: 'Sun',
      badge: { name: 'Sun', description: 'Earn 100,000 energy points', icons: {} },
    },
    {
      __typename: 'AssignmentDueDateNotification',
      brandNew: false,
      date: iso(60 * 20),
      url: '/assignments',
      urlsafeKey: 'd',
      numAssignments: 2,
      contentTitle: 'Unit 4: Trigonometry',
      dueDate: new Date(now + 86400000).toISOString(),
      curationNodeIconURL: null,
    },
    {
      __typename: 'AvatarNotification',
      brandNew: false,
      date: iso(60 * 50),
      url: '/profile',
      urlsafeKey: 'e',
      name: 'Purple Pi',
      thumbnailSrc: '',
    },
  ],
};

// Real storage notifies listeners on write, and the popup relies on that to
// re-render, so the fake has to do it too.
const listeners = [];

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => Object.fromEntries(keys.map((k) => [k, state[k]])),
      set: async (patch) => {
        Object.assign(state, patch);
        for (const listener of listeners) listener(patch, 'local');
      },
      remove: async () => {},
    },
    onChanged: { addListener: (fn) => listeners.push(fn) },
  },
  runtime: {
    getManifest: () => ({ version: '1.0.0' }),
    sendMessage: async (message) => {
      // Echo a sent chat message back so the composer can be exercised.
      if (message?.type === 'kanm:chat-send') {
        const chat = state.chats.find((c) => c.id === message.id);
        chat.messages = [
          ...chat.messages,
          {
            key: `local-${Date.now()}`,
            date: new Date().toISOString(),
            content: message.text,
            author: state.profile,
          },
        ];
        chat.lastSeenKey = chat.messages.at(-1).key;
        await chrome.storage.local.set({ chats: [...state.chats] });
      }
      if (message?.type === 'kanm:chat-rename') {
        const chat = state.chats.find((c) => c.id === message.id);
        chat.customTitle = String(message.name ?? '').trim().slice(0, 40);
        await chrome.storage.local.set({ chats: [...state.chats] });
      }
      if (message?.type === 'kanm:chat-delete-message') {
        const chat = state.chats.find((c) => c.id === message.id);
        chat.messages = chat.messages.filter((m) => m.key !== message.messageKey);
        await chrome.storage.local.set({ chats: [...state.chats] });
      }
      if (message?.type === 'kanm:mark-all-read') {
        state.notifications = state.notifications.map((n) => ({ ...n, brandNew: false }));
        await chrome.storage.local.set({ notifications: state.notifications, unreadCount: 0 });
      }
      if (message?.type === 'kanm:load-more') {
        return { ok: true, added: 0 };
      }
      if (message?.type === 'kanm:test-alert') {
        return { ok: true, played: state.soundEnabled };
      }
      if (message?.type === 'kanm:diagnose') {
        return {
          ok: true,
          report: [
            'OK   Signed in (KAAS cookie) — 212 chars',
            'OK   CSRF token (fkey cookie) — 32 chars',
            'OK   Read your profile — Colin',
            'OK   Read the program link — 6586620957786112',
            'FAIL Read that program’s Tips & Thanks — feedbackQuery failed (HTTP 403)',
          ].join(String.fromCharCode(10)),
        };
      }
      return { ok: true };
    },
    getURL: (p) => p,
  },
};
