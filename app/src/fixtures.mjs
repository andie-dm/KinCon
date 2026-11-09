export const intents = [
  'Find a poster buddy',
  'Meet like-minded people',
  'Connect around a problem',
  'Broaden my research',
];

export const preferences = ['Peers at my stage', 'Open to mentoring', 'Any stage'];

export const defaultProfile = {
  intent: intents[0],
  offers: 'Imitation learning, Python',
  asks: 'Flow matching, Robotics',
  preference: preferences[0],
};

const occurrence = {
  format: 'Poster',
  start: '12:30 PM',
  end: '2:30 PM',
  room: 'Exhibit Hall E',
  date: 'March 1, 2025',
  timezone: 'America/New_York',
  source: 'Fictional session fixture, not a verified schedule',
};

const research = [
  { id: 'flow-skills', title: 'A little flow. A lot of possibility.', subtitle: 'Learning robot skills with flow matching', authors: 'M. Rivera, S. Park & L. Okafor', tags: ['Robotics', 'Flow matching', 'Imitation learning'], theme: 'robot', summary: 'What if a robot could learn a new movement from just a handful of demonstrations? Explore a fictional research example connecting flow-based models and everyday manipulation.', format: 'Poster' },
  { id: 'robot-foresight', title: 'Robots that think a move ahead.', subtitle: 'Visual foresight for self-correcting manipulation', authors: 'T. Brooks, A. Nair & E. Lin', tags: ['Robotics', 'Computer vision'], theme: 'vision', summary: 'A fixture about robots predicting what their next action might look like, then correcting their course before making a mistake.', format: 'Poster' },
  { id: 'language-plans', title: 'From a few words to a good plan.', subtitle: 'Language-guided planning in unfamiliar spaces', authors: 'D. Shah & R. Kim', tags: ['Language models', 'Robotics'], theme: 'robot', summary: 'A fictional talk exploring how language can help an embodied agent turn an unfamiliar task into smaller, useful steps.', format: 'Oral' },
  { id: 'human-feedback', title: 'A better learning loop starts with us.', subtitle: 'Teaching agents through everyday human feedback', authors: 'C. Reed & J. Silva', tags: ['Human-AI interaction', 'Imitation learning'], theme: 'vision', summary: 'An adjacent-field fixture about making feedback more useful, more understandable and less work for the person giving it.', format: 'Poster' },
  { id: 'climate-models', title: 'Small models. A bigger picture.', subtitle: 'Efficient learning for local climate forecasting', authors: 'P. Das & N. Wilson', tags: ['Climate AI', 'Efficient learning'], theme: 'vision', summary: 'A fictional cross-field research example about bringing useful forecasts to places where compute is limited.', format: 'Oral' },
  { id: 'safe-motion', title: 'Learning to move, without the surprises.', subtitle: 'Safe exploration for collaborative robots', authors: 'K. Patel & F. Laurent', tags: ['Robotics', 'Safe learning'], theme: 'robot', summary: 'A fictional poster about balancing curiosity with safe behavior when robots learn alongside people.', format: 'Poster' },
].map((paper) => ({
  ...paper,
  type: 'research',
  evidence: ['Illustrative paper and author names. Not an actual AAAI publication.'],
  occurrences: paper.format === 'Poster' ? [{ ...occurrence }] : [],
}));

const people = [
  { id: 'jules', title: 'Jules Chen', stage: 'Graduate researcher', initials: 'JC', subtitle: 'A fellow newcomer, one good question at a time.', offers: 'Flow matching, robot learning', asks: 'Imitation learning, poster buddies', tags: ['Robotics', 'Flow matching'], color: 'peach', evidence: ['Self-declared interest: flow matching', 'Demo project: tabletop robot experiments'], posterId: 'flow-skills' },
  { id: 'alex', title: 'Alex Morgan', stage: 'Graduate researcher', initials: 'AM', subtitle: 'Here for new ideas and friendly research tangents.', offers: 'Imitation learning, Python', asks: 'Flow matching, Robotics', tags: ['Robotics', 'Imitation learning'], color: 'mint', evidence: ['Self-declared interest: imitation learning'], posterId: 'flow-skills' },
  { id: 'sam', title: 'Sam Okafor', stage: 'Undergraduate student', initials: 'SO', subtitle: 'First conference. Plenty of curiosity.', offers: 'Python, open-source tools', asks: 'Robotics, meeting other newcomers', tags: ['Robotics', 'Open source'], color: 'lilac', evidence: ['Demo project: a low-cost robot arm'] },
  { id: 'maya', title: 'Maya Patel', stage: 'Research scientist', initials: 'MP', subtitle: 'Making robot learning work outside the lab.', offers: 'Robot learning, mentoring', asks: 'Safe learning', tags: ['Robotics', 'Safe learning'], color: 'mint', evidence: ['Self-declared expertise: robot learning'] },
  { id: 'leo', title: 'Leo Santos', stage: 'Senior engineer', initials: 'LS', subtitle: 'Less hype, more systems that actually work.', offers: 'Robotics deployment, systems', asks: 'Flow matching', tags: ['Robotics', 'Flow matching'], color: 'peach', evidence: ['Demo project: warehouse simulation toolkit'] },
  { id: 'nia', title: 'Nia Williams', stage: 'Climate researcher', initials: 'NW', subtitle: 'Looking for ideas across field boundaries.', offers: 'Climate modeling', asks: 'Efficient learning', tags: ['Climate AI', 'Efficient learning'], color: 'mint', evidence: ['Self-declared interest: efficient climate models'] },
  { id: 'arun', title: 'Arun Das', stage: 'Independent builder', initials: 'AD', subtitle: 'Building small things that help real people.', offers: 'Prototyping, Python', asks: 'Human-AI interaction', tags: ['Human-AI interaction', 'Open source'], color: 'lilac', evidence: ['Demo project: accessible annotation tools'] },
  { id: 'elle', title: 'Elle Brooks', stage: 'Graduate researcher', initials: 'EB', subtitle: 'Curious about what a model sees.', offers: 'Computer vision', asks: 'Robotics', tags: ['Computer vision', 'Robotics'], color: 'peach', evidence: ['Self-declared interest: visual foresight'] },
  { id: 'rory', title: 'Rory Kim', stage: 'Research scientist', initials: 'RK', subtitle: 'Always up for a conversation about planning.', offers: 'Language models', asks: 'Embodied agents', tags: ['Language models', 'Robotics'], color: 'lilac', evidence: ['Self-declared interest: language-guided planning'] },
  { id: 'tess', title: 'Tess Laurent', stage: 'Product engineer', initials: 'TL', subtitle: 'A practical perspective on human feedback.', offers: 'Human-AI interaction', asks: 'Imitation learning', tags: ['Human-AI interaction', 'Imitation learning'], color: 'mint', evidence: ['Demo project: interactive feedback interface'] },
  { id: 'kai', title: 'Kai Reed', stage: 'Graduate researcher', initials: 'KR', subtitle: 'Happiest with a whiteboard and a tricky question.', offers: 'Safe learning', asks: 'Robot learning', tags: ['Safe learning', 'Robotics'], color: 'peach', evidence: ['Self-declared interest: safe exploration'] },
  { id: 'dev', title: 'Dev Park', stage: 'Graduate researcher', initials: 'DP', subtitle: 'Not available for discovery in this demo.', offers: 'Robotics', asks: 'Flow matching', tags: ['Robotics'], color: 'lilac', evidence: ['Unavailable fictional profile'], available: false },
].map((person) => ({ ...person, type: 'people', available: person.available ?? true, optedIn: true, occurrences: [] }));

const groups = [
  { id: 'robot-walk', title: 'Robot people, assemble.', subtitle: 'A low-pressure poster walk', host: 'Jules Chen', audience: 'All stages welcome', style: 'Curious questions, no pitches', tags: ['Robotics', 'Flow matching'], time: '12:20 PM', place: 'Exhibit Hall E entrance', size: 3, capacity: 6, color: 'mint', summary: 'Meet by the entrance, say hello, then explore a few posters together. No expertise required. Bring one question you have been meaning to ask.' },
  { id: 'first-timers', title: 'First conference? Same here.', subtitle: 'Coffee with fellow newcomers', host: 'Sam Okafor', audience: 'Newcomers at any stage', style: 'Friendly, informal chat', tags: ['Open source', 'Human-AI interaction'], time: '3:00 PM', place: 'Public lobby coffee stand', size: 4, capacity: 6, color: 'peach', summary: 'A small fictional meetup for comparing notes, sharing a favorite talk, and making the next conference day feel a little less overwhelming.' },
  { id: 'cross-field', title: 'Your field meets mine.', subtitle: 'An interdisciplinary idea swap', host: 'Nia Williams', audience: 'All stages welcome', style: 'One idea each, plenty of listening', tags: ['Climate AI', 'Efficient learning'], time: '4:00 PM', place: null, size: 2, capacity: 5, color: 'lilac', summary: 'Bring one useful idea from your field and one problem you cannot stop thinking about. The host has not confirmed a public meeting point yet.' },
].map((group) => ({ ...group, type: 'groups', evidence: ['Fictional host-created meetup'], occurrences: [] }));

// Every fictional attendee is a playable demo identity, so whoever receives a
// chat request can be switched to and answer it. Alex and Jules come first.
const rank = (id) => (id === 'alex' ? 0 : id === 'jules' ? 1 : 2);
const playable = [...people].sort((a, b) => rank(a.id) - rank(b.id));
export const identities = playable.map(({ id, title, stage, initials, color }) => ({ id, name: title, stage, initials, color }));

// Alex and Jules keep the shared demo profile; everyone else starts from what
// their card says they offer and want to learn.
export function profileFor(id) {
  if (id === 'alex' || id === 'jules') return { ...defaultProfile };
  const person = people.find((p) => p.id === id);
  return { intent: intents[1], offers: person.offers, asks: person.asks, preference: preferences[2] };
}

export const cards = [...research, ...people, ...groups];
export const findCard = (type, id) => cards.find((card) => card.type === type && card.id === id);
