'use strict';
// IDs and index names. Must match scripts/confdata/{ids,mappings}.py.
const crypto = require('node:crypto');

const EVENT_ID = 'aaai-25-replay';
const CONFERENCE_ID = 'aaai-25';
const INDEX = {
  papers: 'conference-papers-2025-v1',
  people: 'conference-people-v1',
  groups: 'conference-groups-v1',
  actions: 'conference-actions-v1',
  events: 'conference-events-v1',
  messages: 'conference-messages-v1',
};

// Two fictional demo identities (fixtures/people.json demo_sessions).
const DEMO_SESSIONS = {
  riley: `${EVENT_ID}.riley`,
  jules: `${EVENT_ID}.jules`,
};

const DECK_TARGET = { research: 'paper', people: 'person', groups: 'group' };

function actionId(eventId, actor, kind, targetType, targetId) {
  const key = `${eventId}|${actor}|${kind}|${targetType}|${targetId}`;
  return 'act_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

const STAGE_BAND = {
  undergrad: 'undergrad', masters: 'grad', phd: 'grad', postdoc: 'early_career',
  industry_engineer: 'early_career', industry_data_scientist: 'early_career',
  faculty: 'senior', senior_industry: 'senior',
};

// One conversation per pair of attendees in an event, whoever asked first.
function conversationId(eventId, a, b) {
  const key = `${eventId}|${[a, b].sort().join('|')}`;
  return 'conv_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function messageId(conversation, sender, clientMessageId) {
  const key = clientMessageId ? `${conversation}|${sender}|${clientMessageId}` : `${conversation}|${sender}|${crypto.randomUUID()}`;
  return 'msg_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

module.exports = { EVENT_ID, CONFERENCE_ID, INDEX, DEMO_SESSIONS, DECK_TARGET, STAGE_BAND, actionId, conversationId, messageId };
