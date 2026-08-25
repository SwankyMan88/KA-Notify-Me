const FALLBACK_ICON = '../../icons/48.png';

/** Turns a possibly-relative Khan Academy asset path into something loadable. */
function icon(...candidates) {
  for (const src of candidates) {
    if (!src) continue;
    if (src.startsWith('https://')) return src;
    if (src.startsWith('//')) return `https:${src}`;
    if (src.startsWith('/')) return `https://cdn.kastatic.org${src}`;
  }
  return FALLBACK_ICON;
}

const UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

export function relativeTime(iso) {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';

  for (const [unit, size] of UNITS) {
    if (seconds >= size) {
      const value = Math.floor(seconds / size);
      return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

/** Strips the light markdown Khan Academy allows in comment bodies. */
function plain(text) {
  if (!text) return '';
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const FEEDBACK_VERB = {
  REPLY: 'replied',
  COMMENT: 'commented',
  QUESTION: 'asked a question',
  ANSWER: 'answered your question',
};

/**
 * Reduces any notification shape Khan Academy sends into the three fields the
 * list renders. Unknown types fall through to a readable default rather than
 * disappearing.
 */
export function describe(n) {
  switch (n.__typename) {
    case 'ResponseFeedbackNotification':
      return {
        icon: icon(n.authorAvatarUrl),
        title: `${n.authorNickname} ${FEEDBACK_VERB[n.feedbackType] ?? 'left feedback'}`,
        body: plain(n.content) || n.focusTranslatedTitle || '',
      };

    case 'ProgramFeedbackNotification':
      return {
        icon: icon(n.authorAvatarSrc),
        title: `${n.authorNickname} ${FEEDBACK_VERB[n.feedbackType] ?? 'left feedback'} on ${n.translatedScratchpadTitle}`,
        body: plain(n.content),
      };

    case 'BadgeNotification':
      return {
        icon: icon(n.badge?.icons?.compactUrl),
        title: `You earned "${n.badge?.name ?? n.badgeName}"`,
        body: n.badge?.description ?? '',
      };

    case 'GroupedBadgeNotification': {
      const badges = [].concat(n.badgeNotifications ?? []);
      return {
        icon: icon(badges[0]?.badge?.icons?.compactUrl),
        title: `You earned ${badges.length || 'new'} badges`,
        body: badges.map((b) => b.badge?.description).filter(Boolean).join(' · '),
      };
    }

    case 'AvatarNotification':
      return {
        icon: icon(n.thumbnailSrc),
        title: `New avatar unlocked: ${n.name}`,
        body: '',
      };

    case 'AssignmentCreatedNotification':
      return {
        icon: icon(n.curationNodeIconURL),
        title: `${n.numAssignments} new assignment${n.numAssignments === 1 ? '' : 's'}`,
        body: [n.contentTitle, n.className].filter(Boolean).join(' · '),
      };

    case 'AssignmentDueDateNotification':
      return {
        icon: icon(n.curationNodeIconURL),
        title: `${n.numAssignments} assignment${n.numAssignments === 1 ? '' : 's'} due soon`,
        body: [n.contentTitle, n.dueDate && `due ${new Date(n.dueDate).toLocaleDateString()}`]
          .filter(Boolean)
          .join(' · '),
      };

    case 'CourseMasteryGoalCreatedNotification':
      return {
        icon: icon(n.curationNodeIconURL),
        title: `New mastery goal: ${n.curationNodeTranslatedTitle}`,
        body: `Target ${n.masteryPercentage}% mastery`,
      };

    case 'ThreadCreatedNotification':
      return {
        icon: FALLBACK_ICON,
        title: `${n.coachee?.nickname ?? 'A student'} started a discussion`,
        body: n.flagged ? 'This content was flagged.' : '',
      };

    case 'CoachRequestNotification':
      return {
        icon: FALLBACK_ICON,
        title: `${n.coach?.nickname ?? 'Someone'} wants to be your ${n.coachIsParent ? 'parent' : 'coach'}`,
        body: '',
      };

    case 'CoachRequestAcceptedNotification':
      return {
        icon: FALLBACK_ICON,
        title: `${n.student?.nickname ?? 'A student'} accepted your invitation`,
        body: n.classroom?.name ?? '',
      };

    case 'ModeratorNotification':
      return { icon: FALLBACK_ICON, title: 'Message from a moderator', body: plain(n.text) };

    case 'InfoNotification':
      return { icon: FALLBACK_ICON, title: 'Khan Academy', body: n.notificationType ?? '' };

    default:
      return {
        icon: FALLBACK_ICON,
        title: 'New notification',
        body: n.__typename?.replace(/Notification$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') ?? '',
      };
  }
}

export function linkFor(n) {
  if (!n.url) return 'https://www.khanacademy.org/notifications';
  return n.url.startsWith('http') ? n.url : `https://www.khanacademy.org${n.url}`;
}
