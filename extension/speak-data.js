// What is talked about in speaking practice: the IELTS Speaking test's three parts, and everyday
// situations played out with Gemini, in any language. Pure: tested in Node.

// Part 1: a topic, a few short questions on it. Part 2: a card to talk about for two minutes, and
// the Part 3 questions that go deeper into its subject.
const SL_IELTS = {
  part1: [
    { topic: 'Home', questions: ['Do you live in a house or a flat?', 'What do you like most about the place where you live?', 'Is there anything you would like to change about your home?', 'Do you plan to live there for a long time?'] },
    { topic: 'Work or studies', questions: ['Do you work or are you a student?', 'Why did you choose that job or subject?', 'What is the most interesting part of it?', 'Would you like to change anything about it in the future?'] },
    { topic: 'Hometown', questions: ['Where is your hometown?', 'What is it known for?', 'How has it changed since you were a child?', 'Would you recommend it to a tourist? Why?'] },
    { topic: 'Free time', questions: ['What do you usually do in your free time?', 'Do you prefer spending free time alone or with others?', 'Has the way you spend your free time changed over the years?', 'Is there a new hobby you would like to try?'] },
    { topic: 'Films and TV', questions: ['How often do you watch films?', 'What kind of films or series do you enjoy?', 'Do you prefer watching at home or at the cinema?', 'Is there a series you would watch again?'] },
    { topic: 'Food', questions: ['What is your favourite food?', 'Do you cook at home?', 'Is there any food you did not like as a child but like now?', 'Do you think people in your country eat more healthily than before?'] },
    { topic: 'Technology', questions: ['How much time do you spend on your phone every day?', 'Which app do you use the most?', 'Do you think you use technology too much?', 'What piece of technology would you find it hard to live without?'] },
    { topic: 'Travel', questions: ['Do you like travelling?', 'What was the last place you visited?', 'Do you prefer travelling by plane, train or car?', 'Where would you like to go next?'] },
    { topic: 'Weather', questions: ['What is the weather usually like where you live?', 'What is your favourite season?', 'Does the weather affect your mood?', 'Do you check the weather forecast often?'] },
    { topic: 'Languages', questions: ['How many languages can you speak?', 'Why are you learning English?', 'What is the most difficult part of learning a language for you?', 'Would you like to learn another language in the future?'] },
    { topic: 'Sport', questions: ['Do you play any sports?', 'Did you do sport at school?', 'Do you prefer watching sport or doing it?', 'Is there a sport you would like to learn?'] },
    { topic: 'Mornings', questions: ['Are you a morning person?', 'What do you usually do first in the morning?', 'Has your morning routine changed recently?', 'What would your perfect morning look like?'] },
  ],
  part2: [
    {
      card: 'Describe a skill you learned that you are proud of.',
      points: ['what the skill is', 'when and how you learned it', 'how difficult it was', 'and explain why you are proud of it'],
      part3: ['Which skills do you think young people should learn at school?', 'Is it better to learn a skill from a teacher or by yourself online?', 'Why do some adults find it hard to learn new things?'],
    },
    {
      card: 'Describe a film or series that made a strong impression on you.',
      points: ['what it was', 'when you watched it', 'what it was about', 'and explain why it made such an impression on you'],
      part3: ['Why do people enjoy watching stories about other people’s lives?', 'Do you think films can change the way people think?', 'How has streaming changed the way people watch films?'],
    },
    {
      card: 'Describe a person who has helped you a lot.',
      points: ['who the person is', 'how you know them', 'how they helped you', 'and explain how you felt about their help'],
      part3: ['Why do some people find it difficult to ask for help?', 'Should helping others be taught to children?', 'Do people help their neighbours less than in the past?'],
    },
    {
      card: 'Describe a place you visited that you would like to go back to.',
      points: ['where it is', 'when you went there', 'what you did there', 'and explain why you would like to go back'],
      part3: ['What makes a place attractive to tourists?', 'Does tourism do more good than harm to a place?', 'How might travel change in the future?'],
    },
    {
      card: 'Describe a time when you had to make an important decision.',
      points: ['what the decision was', 'when you made it', 'how you made it', 'and explain how you felt about it afterwards'],
      part3: ['What kind of decisions do young people have to make today?', 'Should parents make important decisions for their children?', 'Is it better to decide quickly or to take a lot of time?'],
    },
    {
      card: 'Describe a piece of technology you find very useful.',
      points: ['what it is', 'when you started using it', 'what you use it for', 'and explain why you find it so useful'],
      part3: ['How has technology changed the way people communicate?', 'Are there any disadvantages to relying on technology?', 'What technology do you think will be most important in the future?'],
    },
    {
      card: 'Describe a book or article you read that taught you something.',
      points: ['what it was', 'when you read it', 'what it was about', 'and explain what you learned from it'],
      part3: ['Do people read less than they used to?', 'What are the advantages of reading on paper rather than on a screen?', 'How can parents encourage children to read?'],
    },
    {
      card: 'Describe a goal you would like to achieve in the next few years.',
      points: ['what the goal is', 'why you chose it', 'what you are doing to reach it', 'and explain how you will feel when you achieve it'],
      part3: ['Is it important for people to set goals?', 'Why do many people give up on their goals?', 'Should companies help their employees reach personal goals?'],
    },
    {
      card: 'Describe a celebration or special event you enjoyed.',
      points: ['what the event was', 'where and when it took place', 'who was there', 'and explain why you enjoyed it'],
      part3: ['Why do people celebrate special occasions?', 'Have celebrations in your country changed over the years?', 'Do you think people spend too much money on celebrations?'],
    },
    {
      card: 'Describe a time when you were very busy.',
      points: ['when it was', 'why you were so busy', 'how you managed your time', 'and explain how you felt during that time'],
      part3: ['Why are people busier today than in the past?', 'How can people balance work and free time?', 'Is being busy always a bad thing?'],
    },
  ],
};

// Everyday situations, played out in the language being learnt: Gemini plays the other person.
// `role` and `situation` are written for Gemini; the title is shown.
const SL_SCENES = [
  { id: 'day', icon: '☕', title: { en: 'How was your day?', tr: 'Günün nasıldı?' }, role: 'a close friend', situation: 'You meet the learner in the evening and ask about their day, sharing a little about yours.' },
  { id: 'cafe', icon: '🥐', title: { en: 'At a café', tr: 'Kafede sipariş' }, role: 'a friendly waiter', situation: 'The learner has just sat down at your café to order food and a drink, and will pay at the end.' },
  { id: 'doctor', icon: '🩺', title: { en: 'A doctor’s appointment', tr: 'Doktordan randevu' }, role: 'the receptionist of a doctor’s practice, on the phone', situation: 'The learner calls to make an appointment; ask what the problem is and find a time that suits.' },
  { id: 'colleague', icon: '💼', title: { en: 'A new colleague', tr: 'Yeni iş arkadaşı' }, role: 'a new colleague in the learner’s office', situation: 'It is your first week; you get to know the learner during a coffee break.' },
  { id: 'directions', icon: '🗺️', title: { en: 'Asking the way', tr: 'Yol sormak' }, role: 'a helpful local on the street', situation: 'The learner is lost in your city and asks you the way to the train station.' },
  { id: 'shop', icon: '🛍️', title: { en: 'Returning something', tr: 'Ürün iadesi' }, role: 'a shop assistant', situation: 'The learner wants to return or exchange something they bought last week.' },
  { id: 'hotel', icon: '🏨', title: { en: 'Checking in', tr: 'Otelde giriş' }, role: 'a hotel receptionist', situation: 'The learner arrives to check in; there is a small problem with the booking that you solve together.' },
  { id: 'flat', icon: '🔧', title: { en: 'A problem in the flat', tr: 'Evde bir arıza' }, role: 'the landlord, on the phone', situation: 'The learner calls about something broken in their flat; agree on when it will be fixed.' },
  { id: 'neighbour', icon: '🏡', title: { en: 'Meeting a neighbour', tr: 'Komşuyla sohbet' }, role: 'a chatty neighbour', situation: 'You meet the learner in the stairwell and have a friendly chat.' },
  { id: 'plans', icon: '📅', title: { en: 'Weekend plans', tr: 'Hafta sonu planı' }, role: 'a friend', situation: 'You are making plans together for the weekend and need to agree on what to do and when.' },
  { id: 'interview', icon: '🎤', title: { en: 'A job interview', tr: 'İş görüşmesi' }, role: 'a friendly interviewer', situation: 'The learner is interviewing for a job they want; ask the usual questions, one at a time.' },
  { id: 'free', icon: '💬', title: { en: 'Free talk', tr: 'Serbest sohbet' }, role: 'a curious, friendly conversation partner', situation: 'Talk about whatever the learner wants: ask them what is on their mind, and follow their lead.' },
];

const SL_LEVELS = ['A2', 'B1', 'B2', 'C1'];

// The overall band of the Speaking test: the mean of the four, to the nearest half band (a quarter
// goes up).
function slIeltsOverall(bands) {
  const values = ['fluency', 'lexical', 'grammar', 'pronunciation'].map((k) => Number(bands && bands[k])).filter((v) => !isNaN(v));
  if (values.length !== 4) return null;
  const mean = values.reduce((a, b) => a + b, 0) / 4;
  return Math.floor(mean * 2 + 0.5) / 2;
}

// A few saved words of the language to try to use: those still being learnt first.
function slWordsToTry(words, lang, n, rand = Math.random) {
  return words
    .filter((w) => (w.lang || 'en') === lang && slKindOf(w) !== 'sentence' && w.word.length > 2)
    .map((w) => ({ w, order: (slStatus(w) === 'learned' ? 1 : 0) + rand() }))
    .sort((a, b) => a.order - b.order)
    .slice(0, n)
    .map((x) => x.w.word);
}

if (typeof module !== 'undefined') module.exports = { SL_IELTS, SL_SCENES, SL_LEVELS, slIeltsOverall, slWordsToTry };
