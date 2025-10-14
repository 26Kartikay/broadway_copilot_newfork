import cron from 'node-cron';
import { sendMenu } from '../lib/twilio';
import { prisma } from '../lib/prisma';

const buttons = [
  { text: 'Vibe Check', id: 'vibe_check' },
  { text: 'Color Analysis', id: 'color_analysis' },
  { text: 'Style Studio', id: 'styling' },
];
const greetingText = 'Hey! Broadway AI here. What would you like to do today?';

// Helper delay function
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Send messages in batches with delay between batches
async function sendGreetingMenuInBatches() {
  const users = await prisma.user.findMany({ where: { dailyPromptOptIn: true } });

  const batchSize = 4;
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (user) => {
        try {
          await sendMenu(user.whatsappId, greetingText, buttons);
          console.log(`Sent greeting menu to ${user.whatsappId}`);
        } catch (error) {
          console.error(`Failed to send greeting menu to ${user.whatsappId}`, error);
        }
      })
    );

    // If there are more batches, wait 4 minutes before next batch
    if (i + batchSize < users.length) {
      console.log(`Waiting 4 minutes before sending next batch...`);
      await delay(4 * 60 * 1000); // 4 minutes
    }
  }
}

cron.schedule('50 14,18 * * *', sendGreetingMenuInBatches, { timezone: 'Asia/Kolkata' });

console.log('Greeting menu scheduler started');
