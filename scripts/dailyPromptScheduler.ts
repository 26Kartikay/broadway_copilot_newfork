import cron from 'node-cron';
import { prisma } from '../src/lib/prisma';
import { sendMenu } from '../src/lib/twilio';

const buttons = [
  { text: 'Vibe Check', id: 'vibe_check' },
  { text: 'Color Analysis', id: 'color_analysis' },
  { text: 'Style Studio', id: 'styling' },
];
const greetingText = 'Hey! Broadway AI here. What would you like to do today?';

async function sendGreetingMenuOnly() {
  const users = await prisma.user.findMany({ where: { dailyPromptOptIn: true } });

  for (const user of users) {
    try {
      await sendMenu(user.whatsappId, greetingText, buttons);
      console.log(`Sent greeting menu to ${user.whatsappId}`);
    } catch (error) {
      console.error(`Failed to send greeting menu to ${user.whatsappId}`, error);
    }
  }
}

// Schedule greeting menu only at 9 AM and 6 PM daily
cron.schedule('0 9,18 * * *', sendGreetingMenuOnly);

console.log('Greeting menu scheduler started');
