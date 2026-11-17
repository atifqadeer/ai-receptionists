// Default agent setup, shared by Agent Setup and both call simulators.
// Each screen used to carry its own copy: until the user edited a field,
// the calls answered from a knowledge base with no company knowledge and
// no FAQs, while Agent Setup showed the full defaults below.

export const DEFAULT_IDENTITY = {
  agentName: 'Aria',
  companyName: 'TechCorp Solutions',
  language: 'English',
  voice: 'skylar',
  speakingRate: 1.0,
  pitch: 1.0,
};

export const DEFAULT_BEHAVIOR = {
  greeting: 'Hello! Thank you for calling TechCorp Solutions. I\'m Aria, your AI assistant. How can I help you today?',
  farewell: 'Thank you for calling! Have a wonderful day.',
  holdMessage: 'Thank you for your patience. I\'m looking into that for you right now.',
  transferPhrase: 'Let me connect you with a specialist who can better assist you.',
  maxCallDuration: 15,
  silenceTimeout: 8,
  allowInterrupts: true,
  personality: 'professional',
};

export const DEFAULT_KNOWLEDGE = {
  businessHours: 'Monday to Friday, 9:00 AM to 6:00 PM EST',
  address: '123 Innovation Drive, Suite 400, San Francisco, CA 94102',
  phone: '+1 (555) 123-4567',
  email: 'support@techcorp.com',
  services: 'Web Development, Mobile Apps, Cloud Solutions, AI Integration',
  companyInfo: 'TechCorp Solutions is a software company based in San Francisco, California.\nWe build web applications, mobile apps, cloud solutions and AI integrations for startups and enterprises.\nOur team has more than 40 engineers, designers and project managers.\nWe offer a free 30-minute consultation for every new project.\nA basic business website starts at $2,500; full project pricing depends on the scope.\nEvery project includes 3 months of free support after launch.\nTo start a project, email support@techcorp.com or call +1 (555) 123-4567.',
  documents: [] as Array<{ name: string; content: string }>,
  faqs: [
    { q: 'What are your business hours?', a: 'We are open Monday to Friday, 9 AM to 6 PM EST.' },
    { q: 'How do I book an appointment?', a: 'I can help you book an appointment right now. What date and time works best for you?' },
    { q: 'What services do you offer?', a: 'We offer web development, mobile apps, cloud solutions, and AI integration services.' },
  ],
};
