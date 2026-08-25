import { displayTitle, roomUrl } from '../lib/chat.js';
import * as store from '../lib/storage.js';
import { relativeTime } from './format.js';
import { send } from './messaging.js';

const el = (id) => document.getElementById(id);
const FALLBACK_AVATAR = '../../icons/48.png';

const ui = {
  home: el('chat-home'),
  room: el('chat-room'),

  showCreate: el('show-create'),
  showJoin: el('show-join'),
  createForm: el('create-form'),
  joinForm: el('join-form'),
  programInput: el('program-input'),
  createBtn: el('create-chat'),
  codeInput: el('code-input'),
  joinBtn: el('join-chat'),
  error: el('chat-error'),
  errorText: el('chat-error-text'),
  runCheck: el('run-check'),
  shareCode: el('share-code'),
  report: el('chat-report'),
  list: el('chat-list'),
  empty: el('chat-empty'),

  back: el('chat-back'),
  name: el('room-name'),
  members: el('room-members'),
  menuBtn: el('room-menu'),
  options: el('room-options'),
  code: el('room-code'),
  copyBtn: el('copy-code'),
  openLink: el('room-open'),
  leaveBtn: el('leave-room'),
  renameInput: el('rename-input'),
  renameSave: el('rename-save'),
  roomNameInput: el('room-name-input'),
  messages: el('messages'),
  roomError: el('room-error'),
  composer: el('composer'),
  input: el('composer-input'),
  sendBtn: el('composer-send'),
};

let openRoomId = null;
/** Signature of the messages currently drawn, so we only redraw on change. */
let drawn = '';

function showError(node, message) {
  node.textContent = message ?? '';
  node.hidden = !message;
}

/** The chat error box holds a retry affordance, so its text lives in a child. */
function showChatError(message) {
  ui.errorText.textContent = message ?? '';
  ui.error.hidden = !message;
  if (!message) {
    ui.report.hidden = true;
    ui.report.textContent = '';
  }
}

function avatar(src, className = 'msg-avatar') {
  const image = document.createElement('img');
  image.className = className;
  image.src = src ?? FALLBACK_AVATAR;
  image.alt = '';
  image.addEventListener('error', () => {
    image.src = FALLBACK_AVATAR;
  });
  return image;
}

/* ------------------------------ room list ------------------------------ */

function buildRoomRow(chat) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'room';

  const avatars = document.createElement('div');
  avatars.className = 'room-avatars';
  const faces = chat.members.slice(0, 3);
  if (faces.length === 0) avatars.append(avatar(null, ''));
  else for (const member of faces) avatars.append(avatar(member.avatarSrc, ''));

  const info = document.createElement('div');
  info.className = 'room-info';

  const title = document.createElement('p');
  title.className = 'room-name';
  title.textContent = displayTitle(chat);

  // The room id is shown so two rooms on one program stay tellable apart.
  const tag = document.createElement('span');
  tag.className = 'room-tag';
  tag.textContent = chat.roomId;
  title.append(tag);

  const last = document.createElement('p');
  last.className = 'room-last';
  const newest = chat.messages.at(-1);
  last.textContent = newest
    ? `${newest.author.nickname}: ${newest.content}`
    : chat.members.length
      ? chat.members.map((m) => m.nickname).join(', ')
      : 'Share the code to get started';

  info.append(title, last);
  row.append(avatars, info);

  if (chat.unread > 0) {
    const pill = document.createElement('span');
    pill.className = 'room-pill';
    pill.textContent = String(chat.unread);
    row.append(pill);
  }

  const wrapper = document.createElement('li');
  wrapper.append(row);
  row.addEventListener('click', () => openRoom(chat.id));
  return wrapper;
}

function renderHome(chats) {
  ui.empty.hidden = chats.length > 0;
  ui.list.replaceChildren(...chats.map(buildRoomRow));
}

/* ------------------------------ open room ------------------------------ */

function buildMessage(message, previous, selfKaid) {
  const isSelf = message.author.kaid === selfKaid;
  // A run of messages from one person reads better without repeated names.
  const leads = !previous || previous.author.kaid !== message.author.kaid;

  const row = document.createElement('li');
  row.className = ['msg', isSelf && 'msg--self', leads && 'msg--lead'].filter(Boolean).join(' ');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (leads && !isSelf) {
    const who = document.createElement('p');
    who.className = 'bubble-who';
    who.textContent = message.author.nickname;
    bubble.append(who);
  }

  const text = document.createElement('p');
  text.className = 'bubble-text';
  text.textContent = message.content;
  bubble.append(text);

  const time = document.createElement('p');
  time.className = 'bubble-time';
  time.textContent = relativeTime(message.date);
  bubble.append(time);

  const face = avatar(message.author.avatarSrc);
  if (!leads) face.classList.add('msg-avatar--hidden');

  row.append(face, bubble);

  // Only your own messages: Khan Academy refuses the rest anyway, so offering
  // the button would just produce an error.
  if (isSelf) row.append(buildDelete(message));

  return row;
}

/**
 * Two-step, because deleting is not undoable. The first click arms it, the
 * second commits, and moving away disarms it again.
 */
function buildDelete(message) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'msg-delete';
  button.title = 'Delete this message';
  button.textContent = '×';

  let armed = false;
  const disarm = () => {
    armed = false;
    button.classList.remove('msg-delete--armed');
    button.textContent = '×';
  };

  button.addEventListener('mouseleave', disarm);
  button.addEventListener('blur', disarm);

  button.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      button.classList.add('msg-delete--armed');
      button.textContent = 'Delete?';
      return;
    }

    button.disabled = true;
    button.textContent = '…';
    const result = await send({
      type: 'kanm:chat-delete-message',
      id: openRoomId,
      messageKey: message.key,
    });
    if (!result?.ok) {
      button.disabled = false;
      disarm();
      showError(ui.roomError, result?.error ?? 'Could not delete that message.');
    }
  });

  return button;
}

function renderRoom(chat, selfKaid) {
  ui.name.textContent = displayTitle(chat);
  if (document.activeElement !== ui.renameInput) {
    ui.renameInput.value = chat.customTitle || chat.name || '';
  }
  ui.members.textContent = chat.members.length
    ? chat.members.map((m) => m.nickname).join(', ')
    : `Room ${chat.roomId} · share the code to invite someone`;

  ui.code.value = chat.code;
  ui.openLink.href = chat.url ?? roomUrl(chat);
  showError(ui.roomError, chat.error);

  // Redrawing on every poll would fight the scroll position and text selection.
  const signature = chat.messages.map((m) => m.key).join(',');
  if (signature === drawn) return;

  const atBottom =
    ui.messages.scrollHeight - (ui.messages.scrollTop + ui.messages.clientHeight) < 60;

  ui.messages.replaceChildren(
    ...chat.messages.map((message, i) => buildMessage(message, chat.messages[i - 1], selfKaid)),
  );
  drawn = signature;

  if (atBottom || !signature) ui.messages.scrollTop = ui.messages.scrollHeight;

  // Reading the room while it is open keeps it at zero unread.
  const newest = chat.messages.at(-1)?.key ?? null;
  if (newest && newest !== chat.lastSeenKey) send({ type: 'kanm:chat-seen', id: chat.id });
}

export async function openRoomById(id) {
  await openRoom(id);
}

async function openRoom(id) {
  openRoomId = id;
  drawn = '';
  ui.options.hidden = true;
  closeDrawers();
  await store.write({ activeChatId: id });
  await send({ type: 'kanm:chat-seen', id });
  // Do not make the room wait up to a whole poll interval to look current.
  send({ type: 'kanm:chat-refresh' });
}

function closeRoom() {
  openRoomId = null;
  store.write({ activeChatId: null });
}

/* -------------------------------- render ------------------------------- */

export function render(state) {
  const chat = state.chats.find((c) => c.id === openRoomId) ?? null;

  if (!chat) {
    if (openRoomId) openRoomId = null; // the room was removed under us
      ui.room.hidden = true;
    ui.home.hidden = false;
    renderHome(state.chats);
    return;
  }

  ui.home.hidden = true;
  ui.room.hidden = false;
  renderRoom(chat, state.profile?.kaid ?? null);
}

/* -------------------------------- setup -------------------------------- */

function closeDrawers() {
  ui.createForm.hidden = true;
  ui.joinForm.hidden = true;
  ui.showCreate.setAttribute('aria-expanded', 'false');
  ui.showJoin.setAttribute('aria-expanded', 'false');
  showChatError(null);
}

/** Only one drawer is open at a time; clicking the same button closes it. */
function toggleDrawer(which) {
  const opening = which === 'create' ? ui.createForm.hidden : ui.joinForm.hidden;
  closeDrawers();
  if (!opening) return;

  if (which === 'create') {
    ui.createForm.hidden = false;
    ui.showCreate.setAttribute('aria-expanded', 'true');
    ui.programInput.focus();
  } else {
    ui.joinForm.hidden = false;
    ui.showJoin.setAttribute('aria-expanded', 'true');
    ui.codeInput.focus();
  }
}

async function runAction(button, busyLabel, message) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  showChatError(null);

  const result = await send(message);

  button.disabled = false;
  button.textContent = original;

  if (!result?.ok) {
    showChatError(result?.error ?? 'Something went wrong.');
    return null;
  }
  return result;
}

export function setup() {
  ui.showCreate.addEventListener('click', () => toggleDrawer('create'));
  ui.showJoin.addEventListener('click', () => toggleDrawer('join'));

  ui.createForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const program = ui.programInput.value.trim();
    if (!program) return showChatError('Paste a link to one of your programs first.');

    const shareCode = ui.shareCode.checked;
    await store.write({ shareCodeInComment: shareCode });

    const result = await runAction(ui.createBtn, 'Creating…', {
      type: 'kanm:chat-create',
      program,
      shareCode,
      name: ui.roomNameInput.value,
    });
    if (result) {
      ui.programInput.value = '';
      ui.roomNameInput.value = '';
      await openRoom(result.chat.id);
      ui.options.hidden = false; // surface the code straight away
    }
  });

  ui.joinForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const code = ui.codeInput.value.trim();
    if (!code) return showChatError('Paste the code your buddy sent you.');

    const result = await runAction(ui.joinBtn, 'Joining…', { type: 'kanm:chat-join', code });
    if (result) {
      ui.codeInput.value = '';
      await openRoom(result.chat.id);
    }
  });

  ui.runCheck.addEventListener('click', async () => {
    ui.runCheck.disabled = true;
    ui.runCheck.textContent = 'Checking…';
    ui.report.hidden = false;
    ui.report.textContent = 'Running…';

    const result = await send({ type: 'kanm:diagnose', program: ui.programInput.value });
    ui.report.textContent = result?.ok
      ? result.report
      : (result?.error ?? 'The check itself failed.');

    ui.runCheck.disabled = false;
    ui.runCheck.textContent = 'Run a connection check';
  });

  const saveRename = async () => {
    const result = await send({
      type: 'kanm:chat-rename',
      id: openRoomId,
      name: ui.renameInput.value,
    });
    ui.renameSave.textContent = result?.ok ? 'Saved' : 'Failed';
    setTimeout(() => {
      ui.renameSave.textContent = 'Rename';
    }, 1400);
  };

  ui.renameSave.addEventListener('click', saveRename);
  ui.renameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveRename();
    }
  });

  ui.back.addEventListener('click', closeRoom);

  ui.menuBtn.addEventListener('click', () => {
    ui.options.hidden = !ui.options.hidden;
  });

  ui.copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(ui.code.value);
    ui.copyBtn.textContent = 'Copied';
    setTimeout(() => {
      ui.copyBtn.textContent = 'Copy';
    }, 1500);
  });

  ui.leaveBtn.addEventListener('click', async () => {
    const id = openRoomId;
    closeRoom();
    await send({ type: 'kanm:chat-leave', id });
  });

  // Enter sends, Shift+Enter makes a new line.
  ui.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ui.composer.requestSubmit();
    }
  });

  ui.input.addEventListener('input', () => {
    ui.input.style.height = 'auto';
    ui.input.style.height = `${Math.min(ui.input.scrollHeight, 96)}px`;
  });

  ui.composer.addEventListener('submit', async (event) => {
    event.preventDefault();

    const text = ui.input.value.trim();
    if (!text || !openRoomId) return;

    ui.sendBtn.disabled = true;
    ui.input.disabled = true;

    const result = await send({ type: 'kanm:chat-send', id: openRoomId, text });

    ui.input.disabled = false;
    ui.sendBtn.disabled = false;
    ui.input.focus();

    if (result?.ok) {
      ui.input.value = '';
      ui.input.style.height = 'auto';
      showError(ui.roomError, null);
    } else {
      showError(ui.roomError, result?.error ?? 'Could not send that message.');
    }
  });
}

/** Restores whichever room was open last time the popup was closed. */
export async function restore() {
  ui.shareCode.checked = await store.readOne('shareCodeInComment');

  const activeChatId = await store.readOne('activeChatId');
  if (!activeChatId) return;
  openRoomId = activeChatId;
  drawn = '';
}
