// What is practised in speaking and writing: the IELTS test's parts, everyday situations and
// writing tasks, in any language. Pure: tested in Node.

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

// Writing, the IELTS test: Task 2 (an essay), and Task 1 as a letter (General Training) or as a
// report on a table of figures (Academic). The figures are made up for practice.
const SL_WRITING = {
  task2: [
    'Some people think that children should start learning a foreign language at primary school, while others believe they should wait until secondary school. Discuss both views and give your own opinion.',
    'Many people now work from home. Do the advantages of this outweigh the disadvantages?',
    'Watching films and series in a foreign language is a better way to learn it than studying in a classroom. To what extent do you agree or disagree?',
    'In many cities, the cost of housing is rising faster than wages. What are the causes of this problem, and what can be done about it?',
    'Some people believe that social media has made people more connected, while others think it has made them more isolated. Discuss both views and give your own opinion.',
    'Governments should spend more money on public transport than on building new roads. To what extent do you agree or disagree?',
    'More and more people are choosing to live alone. Why is this happening? Is it a positive or negative development?',
    'Some people think that universities should only offer subjects that lead to good jobs. Others believe that students should be free to study what interests them. Discuss both views and give your opinion.',
    'Tourism brings money to many countries, but it can also damage the places people visit. Do the benefits of tourism outweigh its problems?',
    'Artificial intelligence will soon do many of the jobs that people do today. What problems could this cause, and how could they be solved?',
  ],
  letters: [
    { situation: 'You recently stayed at a hotel and left something valuable in your room.', points: ['when you stayed and in which room', 'what you left and what it looks like', 'how you would like it returned to you'] },
    { situation: 'Your neighbour has been making a lot of noise late at night for several weeks.', points: ['who you are and where you live', 'what the problem is and how it affects you', 'what you would like your neighbour to do'] },
    { situation: 'A friend from another country is coming to visit your city for a week.', points: ['what the weather will be like and what to bring', 'places you will take them to', 'what you have planned for the first day'] },
    { situation: 'You bought a piece of furniture online, but it arrived damaged.', points: ['what you bought and when', 'what is wrong with it', 'what you want the company to do'] },
    { situation: 'You would like to take some time off work to do a language course.', points: ['which course you want to do and why', 'how long you would be away', 'how your work could be covered while you are away'] },
    { situation: 'Your local library is planning to close on weekends.', points: ['how you use the library', 'why weekend opening matters to people in your area', 'what the library could do instead'] },
  ],
  tables: [
    {
      title: 'Hours spent per week learning a foreign language, by method, 2015 and 2025 (average per learner)',
      columns: ['Method', '2015', '2025'],
      rows: [['Classroom lessons', '3.5', '2.0'], ['Apps', '0.5', '2.5'], ['Films and series', '1.0', '3.0'], ['Textbooks', '2.0', '0.8'], ['Conversation with native speakers', '0.6', '1.2']],
    },
    {
      title: 'How people travelled to work in one city (% of workers), 2000, 2010 and 2020',
      columns: ['Way of travelling', '2000', '2010', '2020'],
      rows: [['Car', '58', '52', '41'], ['Bus', '22', '20', '17'], ['Train', '9', '12', '15'], ['Bicycle', '4', '8', '14'], ['On foot', '7', '8', '9'], ['Worked from home', '0', '0', '4']],
    },
    {
      title: 'Average monthly household spending in one country (in euros), 2010 and 2024',
      columns: ['Category', '2010', '2024'],
      rows: [['Housing', '620', '980'], ['Food', '410', '520'], ['Transport', '280', '300'], ['Leisure', '190', '240'], ['Communication', '60', '95'], ['Education', '70', '130']],
    },
    {
      title: 'Number of visitors to four museums in one city (thousands), 2019 to 2023',
      columns: ['Museum', '2019', '2020', '2021', '2022', '2023'],
      rows: [['History Museum', '820', '210', '380', '700', '860'], ['Art Gallery', '640', '150', '310', '590', '720'], ['Science Centre', '510', '170', '290', '540', '610'], ['Maritime Museum', '230', '60', '120', '200', '250']],
    },
  ],
};

// Writing, every day, in any language: messages and letters of the kind life asks for (and the
// German B1 exams too). The task is shown in the language of the interface; Gemini reads `en`.
const SL_WRITES = [
  { id: 'landlord', icon: '🔧', title: { en: 'To the landlord', tr: 'Ev sahibine' }, task: { en: 'The heating in your flat has not worked for three days. Write to your landlord.', tr: 'Evindeki kalorifer üç gündür çalışmıyor. Ev sahibine yaz.' }, points: { en: ['what is wrong and since when', 'how it affects you', 'when someone can come to fix it'], tr: ['ne bozuk ve ne zamandan beri', 'bunun seni nasıl etkilediği', 'tamir için ne zaman gelinebileceği'] } },
  { id: 'invite', icon: '🎉', title: { en: 'Replying to an invitation', tr: 'Davete cevap' }, task: { en: 'A friend has invited you to their birthday party, but you cannot go. Write to them.', tr: 'Bir arkadaşın seni doğum günü partisine davet etti ama gidemiyorsun. Ona yaz.' }, points: { en: ['thank them for the invitation', 'why you cannot come', 'suggest meeting another time'], tr: ['davet için teşekkür et', 'neden gelemediğini söyle', 'başka bir zaman buluşmayı öner'] } },
  { id: 'complaint', icon: '📦', title: { en: 'A late delivery', tr: 'Geciken sipariş' }, task: { en: 'You ordered something online two weeks ago and it has still not arrived. Write to the shop.', tr: 'İki hafta önce internetten bir şey sipariş ettin, hâlâ gelmedi. Mağazaya yaz.' }, points: { en: ['what you ordered and when', 'what has happened since', 'what you want them to do now'], tr: ['ne zaman ne sipariş ettiğin', 'o zamandan beri ne olduğu', 'şimdi ne yapmalarını istediğin'] } },
  { id: 'course', icon: '📚', title: { en: 'Signing up for a course', tr: 'Kursa kayıt' }, task: { en: 'You want to join a language course at a school in your town. Write to the school.', tr: 'Şehrindeki bir okulun dil kursuna katılmak istiyorsun. Okula yaz.' }, points: { en: ['which course and why', 'your level and when you are free', 'ask about the price and how to pay'], tr: ['hangi kurs ve neden', 'seviyen ve ne zaman müsait olduğun', 'ücreti ve nasıl ödeneceğini sor'] } },
  { id: 'teacher', icon: '🏫', title: { en: 'To a teacher', tr: 'Öğretmene' }, task: { en: 'Your child will miss school next week. Write to their teacher.', tr: 'Çocuğun gelecek hafta okula gidemeyecek. Öğretmenine yaz.' }, points: { en: ['why your child will be away', 'for how many days', 'ask how they can catch up'], tr: ['çocuğunun neden gelemeyeceği', 'kaç gün', 'kaçırdıklarını nasıl telafi edebileceğini sor'] } },
  { id: 'colleague', icon: '💼', title: { en: 'To a colleague', tr: 'İş arkadaşına' }, task: { en: 'You need to swap a shift with a colleague. Write to them.', tr: 'Bir iş arkadaşınla vardiya değiştirmen gerekiyor. Ona yaz.' }, points: { en: ['which shift and why', 'which of their shifts you could take', 'thank them and ask them to reply soon'], tr: ['hangi vardiya ve neden', 'onun hangi vardiyasını alabileceğin', 'teşekkür et ve kısa sürede cevap vermesini rica et'] } },
  { id: 'review', icon: '🎬', title: { en: 'A film you watched', tr: 'İzlediğin bir film' }, task: { en: 'Write a short review of a film or series you watched recently.', tr: 'Son zamanlarda izlediğin bir film ya da dizi hakkında kısa bir yorum yaz.' }, points: { en: ['what it is about', 'what you liked and did not like', 'who you would recommend it to'], tr: ['ne hakkında olduğu', 'neyi beğenip neyi beğenmediğin', 'kime tavsiye edeceğin'] } },
  { id: 'doctor', icon: '🩺', title: { en: 'Cancelling an appointment', tr: 'Randevu iptali' }, task: { en: 'You cannot go to your doctor’s appointment tomorrow. Write to the practice.', tr: 'Yarınki doktor randevuna gidemeyeceksin. Muayenehaneye yaz.' }, points: { en: ['which appointment', 'why you cannot come', 'ask for a new appointment'], tr: ['hangi randevu', 'neden gelemeyeceğin', 'yeni bir randevu iste'] } },
  { id: 'diary', icon: '📝', title: { en: 'My weekend', tr: 'Hafta sonum' }, task: { en: 'Write to a friend about your last weekend.', tr: 'Bir arkadaşına geçen hafta sonunu anlat.' }, points: { en: ['where you were and with whom', 'what you did', 'how you felt about it'], tr: ['nerede ve kiminle olduğun', 'ne yaptığın', 'nasıl hissettiğin'] } },
  { id: 'free', icon: '✍️', title: { en: 'Free writing', tr: 'Serbest yazı' }, task: { en: 'Write about anything you like: your day, your plans, an opinion.', tr: 'İstediğin bir şey hakkında yaz: günün, planların, bir fikrin.' }, points: { en: [], tr: [] } },
];

// About how many words a task asks for, at each level.
const SL_WRITE_WORDS = { A2: 40, B1: 80, B2: 150, C1: 200 };

// Words in a text, as the IELTS test counts them: what stands between spaces.
function slWordCount(text) {
  return (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

const SL_SPEAKING_KEYS = ['fluency', 'lexical', 'grammar', 'pronunciation'];
const SL_WRITING_KEYS = ['task', 'coherence', 'lexical', 'grammar'];

// The overall band of a test: the mean of its four criteria, to the nearest half band (a quarter
// goes up).
function slIeltsOverall(bands, keys = SL_SPEAKING_KEYS) {
  const values = keys.map((k) => Number(bands && bands[k])).filter((v) => !isNaN(v));
  if (values.length !== 4) return null;
  const mean = values.reduce((a, b) => a + b, 0) / 4;
  return Math.floor(mean * 2 + 0.5) / 2;
}

// A few saved words of the language to try to use: those still being learnt first. A word saved
// from the start of a sentence ("Approaching") is given in lower case; in German nouns keep theirs.
function slWordsToTry(words, lang, n, rand = Math.random) {
  return words
    .filter((w) => (w.lang || 'en') === lang && slKindOf(w) !== 'sentence' && w.word.length > 2)
    .map((w) => ({ w, order: (slStatus(w) === 'learned' ? 1 : 0) + rand() }))
    .sort((a, b) => a.order - b.order)
    .slice(0, n)
    .map((x) => (lang === 'de' ? x.w.word : x.w.word.replace(/^\p{Lu}(?=\p{Ll}*$)/u, (c) => c.toLowerCase())));
}

if (typeof module !== 'undefined') module.exports = { SL_IELTS, SL_SCENES, SL_LEVELS, SL_WRITING, SL_WRITES, SL_WRITE_WORDS, slWordCount, SL_SPEAKING_KEYS, SL_WRITING_KEYS, slIeltsOverall, slWordsToTry };
