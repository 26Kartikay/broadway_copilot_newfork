"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
const twilio_1 = require("../lib/twilio");
const prisma_1 = require("../lib/prisma");
const buttons = [
    { text: 'Vibe Check', id: 'vibe_check' },
    { text: 'Color Analysis', id: 'color_analysis' },
    { text: 'Style Studio', id: 'styling' },
];
const greetingText = 'Hey! Broadway AI here. What would you like to do today?';
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function sendGreetingMenuInBatches() {
    const users = await prisma_1.prisma.user.findMany({ where: { dailyPromptOptIn: true } });
    const batchSize = 4;
    for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        await Promise.all(batch.map(async (user) => {
            try {
                await (0, twilio_1.sendMenu)(user.whatsappId, greetingText, buttons);
                console.log(`Sent greeting menu to ${user.whatsappId}`);
            }
            catch (error) {
                console.error(`Failed to send greeting menu to ${user.whatsappId}`, error);
            }
        }));
        if (i + batchSize < users.length) {
            console.log(`Waiting 4 minutes before sending next batch...`);
            await delay(4 * 60 * 1000);
        }
    }
}
node_cron_1.default.schedule('50 14,18 * * *', sendGreetingMenuInBatches, { timezone: 'Asia/Kolkata' });
console.log('Greeting menu scheduler started');
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9zY2hlZHVsZXIvZGFpbHlQcm9tcHRTY2hlZHVsZXIudHMiLCJzb3VyY2VzIjpbIi91c3Ivc3JjL2FwcC9zcmMvc2NoZWR1bGVyL2RhaWx5UHJvbXB0U2NoZWR1bGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsMERBQTZCO0FBQzdCLDBDQUF5QztBQUN6QywwQ0FBdUM7QUFFdkMsTUFBTSxPQUFPLEdBQUc7SUFDZCxFQUFFLElBQUksRUFBRSxZQUFZLEVBQUUsRUFBRSxFQUFFLFlBQVksRUFBRTtJQUN4QyxFQUFFLElBQUksRUFBRSxnQkFBZ0IsRUFBRSxFQUFFLEVBQUUsZ0JBQWdCLEVBQUU7SUFDaEQsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLEVBQUUsRUFBRSxTQUFTLEVBQUU7Q0FDeEMsQ0FBQztBQUNGLE1BQU0sWUFBWSxHQUFHLHlEQUF5RCxDQUFDO0FBRy9FLFNBQVMsS0FBSyxDQUFDLEVBQVU7SUFDdkIsT0FBTyxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUN6RCxDQUFDO0FBR0QsS0FBSyxVQUFVLHlCQUF5QjtJQUN0QyxNQUFNLEtBQUssR0FBRyxNQUFNLGVBQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsS0FBSyxFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBRWhGLE1BQU0sU0FBUyxHQUFHLENBQUMsQ0FBQztJQUNwQixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksU0FBUyxFQUFFLENBQUM7UUFDakQsTUFBTSxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxDQUFDO1FBRTVDLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FDZixLQUFLLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsRUFBRTtZQUN2QixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxJQUFBLGlCQUFRLEVBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxZQUFZLEVBQUUsT0FBTyxDQUFDLENBQUM7Z0JBQ3ZELE9BQU8sQ0FBQyxHQUFHLENBQUMseUJBQXlCLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1lBQzFELENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsbUNBQW1DLElBQUksQ0FBQyxVQUFVLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUM3RSxDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQ0gsQ0FBQztRQUdGLElBQUksQ0FBQyxHQUFHLFNBQVMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDakMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnREFBZ0QsQ0FBQyxDQUFDO1lBQzlELE1BQU0sS0FBSyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUM7UUFDN0IsQ0FBQztJQUNILENBQUM7QUFDSCxDQUFDO0FBRUQsbUJBQUksQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLEVBQUUseUJBQXlCLEVBQUUsRUFBRSxRQUFRLEVBQUUsY0FBYyxFQUFFLENBQUMsQ0FBQztBQUV6RixPQUFPLENBQUMsR0FBRyxDQUFDLGlDQUFpQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgY3JvbiBmcm9tICdub2RlLWNyb24nO1xyXG5pbXBvcnQgeyBzZW5kTWVudSB9IGZyb20gJy4uL2xpYi90d2lsaW8nO1xyXG5pbXBvcnQgeyBwcmlzbWEgfSBmcm9tICcuLi9saWIvcHJpc21hJztcclxuXHJcbmNvbnN0IGJ1dHRvbnMgPSBbXHJcbiAgeyB0ZXh0OiAnVmliZSBDaGVjaycsIGlkOiAndmliZV9jaGVjaycgfSxcclxuICB7IHRleHQ6ICdDb2xvciBBbmFseXNpcycsIGlkOiAnY29sb3JfYW5hbHlzaXMnIH0sXHJcbiAgeyB0ZXh0OiAnU3R5bGUgU3R1ZGlvJywgaWQ6ICdzdHlsaW5nJyB9LFxyXG5dO1xyXG5jb25zdCBncmVldGluZ1RleHQgPSAnSGV5ISBCcm9hZHdheSBBSSBoZXJlLiBXaGF0IHdvdWxkIHlvdSBsaWtlIHRvIGRvIHRvZGF5Pyc7XHJcblxyXG4vLyBIZWxwZXIgZGVsYXkgZnVuY3Rpb25cclxuZnVuY3Rpb24gZGVsYXkobXM6IG51bWJlcikge1xyXG4gIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcclxufVxyXG5cclxuLy8gU2VuZCBtZXNzYWdlcyBpbiBiYXRjaGVzIHdpdGggZGVsYXkgYmV0d2VlbiBiYXRjaGVzXHJcbmFzeW5jIGZ1bmN0aW9uIHNlbmRHcmVldGluZ01lbnVJbkJhdGNoZXMoKSB7XHJcbiAgY29uc3QgdXNlcnMgPSBhd2FpdCBwcmlzbWEudXNlci5maW5kTWFueSh7IHdoZXJlOiB7IGRhaWx5UHJvbXB0T3B0SW46IHRydWUgfSB9KTtcclxuXHJcbiAgY29uc3QgYmF0Y2hTaXplID0gNDtcclxuICBmb3IgKGxldCBpID0gMDsgaSA8IHVzZXJzLmxlbmd0aDsgaSArPSBiYXRjaFNpemUpIHtcclxuICAgIGNvbnN0IGJhdGNoID0gdXNlcnMuc2xpY2UoaSwgaSArIGJhdGNoU2l6ZSk7XHJcblxyXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoXHJcbiAgICAgIGJhdGNoLm1hcChhc3luYyAodXNlcikgPT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBhd2FpdCBzZW5kTWVudSh1c2VyLndoYXRzYXBwSWQsIGdyZWV0aW5nVGV4dCwgYnV0dG9ucyk7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgU2VudCBncmVldGluZyBtZW51IHRvICR7dXNlci53aGF0c2FwcElkfWApO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gc2VuZCBncmVldGluZyBtZW51IHRvICR7dXNlci53aGF0c2FwcElkfWAsIGVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0pXHJcbiAgICApO1xyXG5cclxuICAgIC8vIElmIHRoZXJlIGFyZSBtb3JlIGJhdGNoZXMsIHdhaXQgNCBtaW51dGVzIGJlZm9yZSBuZXh0IGJhdGNoXHJcbiAgICBpZiAoaSArIGJhdGNoU2l6ZSA8IHVzZXJzLmxlbmd0aCkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgV2FpdGluZyA0IG1pbnV0ZXMgYmVmb3JlIHNlbmRpbmcgbmV4dCBiYXRjaC4uLmApO1xyXG4gICAgICBhd2FpdCBkZWxheSg0ICogNjAgKiAxMDAwKTsgLy8gNCBtaW51dGVzXHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG5jcm9uLnNjaGVkdWxlKCc1MCAxNCwxOCAqICogKicsIHNlbmRHcmVldGluZ01lbnVJbkJhdGNoZXMsIHsgdGltZXpvbmU6ICdBc2lhL0tvbGthdGEnIH0pO1xyXG5cclxuY29uc29sZS5sb2coJ0dyZWV0aW5nIG1lbnUgc2NoZWR1bGVyIHN0YXJ0ZWQnKTtcclxuIl19