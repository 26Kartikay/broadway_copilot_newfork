import cron from 'node-cron';
import { sendMenu } from '../lib/twilio';
import { prisma } from '../lib/prisma';

// A list of 30 fashion and beauty facts, now with emojis and a slight Gen Z tone
const facts: string[] = [
    "The world's most expensive dress, the 'Nightingale of Kuala Lumpur,' is valued at over **$30 million**! 🤯💰",
    "**Mascara** was invented way back in the 19th century by Eugene Rimmel. 👁️✨",
    "The iconic **little black dress (LBD)** was first served by Coco Chanel in 1926. A true classic. 🖤🥂",
    "The average person spends about **15% of their life** shopping for clothes. 🛍️⏰",
    "**Red lipstick** was a powerful symbol for the suffragettes' movement. Slay, Queen! 💄✊",
    "**Denim jeans** were originally made for gold miners during the California Gold Rush. Talk about a glow-up. ⛏️👖",
    "**High heels** were first designed for men in the 10th century to keep their feet in stirrups. Wild, right? 🐎👠",
    "The first **nail polish** was invented in China around 3000 BC, made from beeswax and gelatin. 💅 ancient tech.",
    "The word 'cosmetics' comes from the Greek word 'kosmetikos,' meaning 'skilled in adornment.' 🤓📜",
    "A single **silk thread** from a silkworm cocoon can be up to 1,000 yards long. That's dedication. 🐛🧵",
    "The concept of **'fast fashion'** emerged in the late 20th century. *Tsk Tsk*. 💨👚",
    "**Sunscreen** was invented in 1938 by a Swiss chemist. Bless up. ☀️🧴",
    "The oldest surviving piece of clothing is a linen shirt from ancient Egypt, over **5,000 years old**. Vintag-e. 🏺🪡",
    "The first **foundation**, 'Pan-Cake Make-Up,' was created by Max Factor in 1914. 🎨🎬",
    "The **zipper** was invented in 1893 but only became popular in the 1930s. Thanks, zipper! 🙌",
    "The **'bikini'** was named after the Bikini Atoll, symbolizing its 'explosive' cultural impact. 💣👙",
    "A typical person owns about **seven pairs of jeans**. Are you hitting the quota? 🤔",
    "Queen Elizabeth I wore **white lead makeup**, despite it being super toxic. Not a vibe. ☠️👑",
    "**Lip gloss** was introduced in 1930 to give movie actresses that shiny pout. ✨💋",
    "**Nylon** was developed during WWII as a silk alternative for parachutes. 🪂🤯",
    "The **perfume** industry in France started to, um, mask body odor in the 16th century. 👃🌹",
    "The term **'haute couture'** is protected by French law. Serious fashion business. 🇫🇷👔",
    "The first beauty pageant took place in 1888. 👑🌟",
    "The ancient Greeks and Romans used **olive oil** as a moisturizer. DIY skincare pioneers. 🌿🧖‍♀️",
    "**Tattoos** were common among Egyptian women for status and as permanent makeup. 🇪🇬💉",
    "The **trench coat** was developed for British officers during World War I. Practical and chic. 🧥💂",
    "Matching your **handbag** to your shoes became a thing in the 1920s. Aesthetic goals. 👜👠",
    "The world's largest fashion doll is **Barbie**, introduced in 1959. She's got range. 💖👱‍♀️",
    "The term 'manicure' comes from the Latin for 'hand' and 'care.' 👐💖",
    "Before mirrors, people used **polished metal** to check their look. The struggle was real. 💿👀",
];

// The new, Gen Z-friendly title for the fact message
const FACT_TITLE = '🔥 Broadway AI todays style fact: Did You Know?'; 

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

    // Select a random fact for the day
    const randomFact = facts[Math.floor(Math.random() * facts.length)];
    // Update the fact message with the new title
    const factText = `${FACT_TITLE}\n\n${randomFact}\n\n`; // Fact content is just the random string now

    const batchSize = 4;
    for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);

        await Promise.all(
            batch.map(async (user) => {
                try {
                    // 1. Send the daily fact first
                    await sendMenu(user.whatsappId, factText, []);
                    console.log(`Sent daily fact to ${user.whatsappId}`);

                    // 2. Send the greeting menu
                    await sendMenu(user.whatsappId, greetingText, buttons);
                    console.log(`Sent greeting menu to ${user.whatsappId}`);

                } catch (error) {
                    console.error(`Failed to send messages to ${user.whatsappId}`, error);
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

cron.schedule('0 9,18 * * *', sendGreetingMenuInBatches, { timezone: 'Asia/Kolkata' });
console.log('Greeting menu scheduler started');