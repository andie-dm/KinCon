'use strict';
// Public card shapes. Every field is copied explicitly: raw profile/action
// documents never reach a client. public_links, private openers, other
// people's swipes and opt-in timestamps are never part of a card.

const FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

function locationLabel(o) {
  if (o.verification_status === 'verified' && o.format === 'poster' && o.room) return `Poster scheduled in ${o.room}`;
  if (o.verification_status === 'time_verified_room_unconfirmed') return 'Oral time published; room unconfirmed';
  return 'Time or room unconfirmed';
}

function occurrenceCard(o) {
  return {
    occurrence_id: o.occurrence_id,
    format: o.format,
    session_title: o.session_title || null,
    starts_at: o.starts_at || null,
    ends_at: o.ends_at || null,
    time_zone: o.time_zone,
    when_label: o.starts_at ? FMT.format(new Date(o.starts_at)) + ' ET' : 'Time unconfirmed',
    room: o.room || null,
    building: o.building || null,
    venue: o.venue || null,
    board: o.board || null,
    verification_status: o.verification_status,
    location_label: locationLabel(o),
    source_url: o.source_url,
    // A listing is a schedule fact; it never asserts that a named author attends.
    presence_note: 'Schedule listing only; does not confirm which authors attend.',
  };
}

function paperCard(src, reason, rank) {
  return {
    id: src.paper_id,
    type: 'paper',
    title: src.title,
    subtitle: (src.author_names || []).join(', '),
    authors: (src.authors || []).slice().sort((a, b) => a.position - b.position).map((a) => ({ name: a.name, position: a.position })),
    reason,
    tags: src.tags || [],
    evidence: [{ kind: 'proceedings', label: `AAAI-25 proceedings, vol. ${src.volume} no. ${src.issue}`, url: src.paper_url, doi: src.doi }],
    occurrences: (src.occurrences || []).map(occurrenceCard),
    schedule_status: src.schedule_status || 'unscheduled',
    rank,
  };
}

function personCard(src, reason, rank, context = {}) {
  return {
    id: src.profile_id,
    type: 'person',
    is_fictional: !!src.is_fictional,
    title: src.display_name,
    subtitle: src.stage_label,
    reason,
    tags: src.tags || [],
    offers: src.offers || [],
    asks: src.asks || [],
    conversation_preference: src.conversation_preference,
    evidence: (src.evidence || []).map((e) => ({ kind: e.kind, title: e.title || null, paper_id: e.paper_id || null, url: e.url || null })),
    shared_poster: context.sharedPoster || null,
    // Only what the participant chose to share publicly.
    meeting: src.meeting_point ? { label: src.meeting_point.label, source_url: src.meeting_point.source_url } : null,
    available_windows: (src.available_windows || []).map((w) => ({ starts_at: w.starts_at, ends_at: w.ends_at })),
    occurrences: [],
    rank,
  };
}

function groupCard(src, reason, rank, hostName) {
  return {
    id: src.group_id,
    type: 'group',
    is_fictional: !!src.is_fictional,
    title: src.title,
    subtitle: src.topic,
    reason,
    tags: src.tags || [],
    description: src.description,
    conversation_style: src.conversation_style,
    intended_audience: src.intended_audience,
    stage_restrictions: src.audience_specified ? src.stage_restrictions || [] : [],
    host: hostName || null,
    starts_at: src.starts_at,
    ends_at: src.ends_at,
    time_zone: src.time_zone,
    when_label: src.starts_at ? FMT.format(new Date(src.starts_at)) + ' ET' : 'Time unconfirmed',
    meeting_point: src.meeting_point ? { label: src.meeting_point.label, source_url: src.meeting_point.source_url } : null,
    location_label: src.location_status === 'public_point_confirmed' && src.meeting_point ? `Meet at ${src.meeting_point.label}` : 'Location unconfirmed',
    evidence: [{ kind: 'fixture', label: 'Fictional demo meetup' }],
    occurrences: [],
    rank,
  };
}

module.exports = { paperCard, personCard, groupCard, occurrenceCard, locationLabel };
