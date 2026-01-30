import { Replies, QuickReplyButton } from '../state';
import * as fs from 'fs';
import * as path from 'path';

// Helper to shuffle an array
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Function to get random conversation starters
const CONVERSATION_STARTERS_FILE = path.resolve(__dirname, '..', '..', '..', 'prompts', 'conversation_starters.txt');
let conversationStartersPool: string[] = [];

function loadConversationStarters() {
  if (conversationStartersPool.length === 0) {
    try {
      const content = fs.readFileSync(CONVERSATION_STARTERS_FILE, 'utf-8');
      conversationStartersPool = content.split('\n').map(s => s.trim()).filter(Boolean);
    } catch (error) {
      console.error('Error loading conversation starters:', error);
      // Fallback if file not found
      conversationStartersPool = [
        "What's your style?", "Favorite colors?", "Fashion advice?",
        "Latest trends?", "Outfit ideas?",
      ];
    }
  }
}

export const getConversationStartersButtons = (count: number = 3): QuickReplyButton[] => {
  loadConversationStarters();
  const shuffled = shuffleArray(conversationStartersPool);
  return shuffled.slice(0, count).map(starter => ({
    text: starter,
    id: `conversation_starter_${starter.replace(/\s+/g, '_').toLowerCase().substring(0, 20)}`, // Generate a unique ID
  }));
};

export const getMainMenuReply = (text: string = 'What would you like to do now?'): Replies => {
  const starters = getConversationStartersButtons(3); // Get 3 random starters
  
  return [
    {
      reply_type: 'quick_reply',
      reply_text: text,
      buttons: [
        { text: 'Main Menu', id: 'main_menu' },
        ...starters,
        { text: 'Show me more', id: 'refresh_conversation_starters' }, // New button to refresh starters
      ],
    },
  ];
};
