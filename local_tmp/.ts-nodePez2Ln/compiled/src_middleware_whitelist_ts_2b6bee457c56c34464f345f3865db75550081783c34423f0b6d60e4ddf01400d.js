"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whitelist = void 0;
const prisma_1 = require("../lib/prisma");
const twilio_1 = require("../lib/twilio");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
const whitelist = async (req, res, next) => {
    if (process.env.NODE_ENV === 'development') {
        return next();
    }
    const { WaId } = req.body;
    if (!WaId) {
        return next(new errors_1.ForbiddenError('Unauthorized'));
    }
    try {
        const user = await prisma_1.prisma.userWhitelist.findUnique({
            where: {
                waId: WaId,
            },
        });
        if (!user) {
            logger_1.logger.info(`Unauthorized access attempt by ${WaId}`);
            await (0, twilio_1.sendText)(WaId, "Hey! Thanks for your interest in Broadway. We're currently in a private beta. We'll let you know when we're ready for you!");
            return res.status(403).send('Forbidden');
        }
        next();
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Error in whitelist middleware');
        next(new errors_1.InternalServerError('Internal Server Error'));
    }
};
exports.whitelist = whitelist;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy9taWRkbGV3YXJlL3doaXRlbGlzdC50cyIsInNvdXJjZXMiOlsiL3Vzci9zcmMvYXBwL3NyYy9taWRkbGV3YXJlL3doaXRlbGlzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSwwQ0FBdUM7QUFDdkMsMENBQXlDO0FBRXpDLDRDQUFzRTtBQUN0RSw0Q0FBeUM7QUFFbEMsTUFBTSxTQUFTLEdBQUcsS0FBSyxFQUFFLEdBQVksRUFBRSxHQUFhLEVBQUUsSUFBa0IsRUFBRSxFQUFFO0lBQ2pGLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEtBQUssYUFBYSxFQUFFLENBQUM7UUFDM0MsT0FBTyxJQUFJLEVBQUUsQ0FBQztJQUNoQixDQUFDO0lBRUQsTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLEdBQUcsQ0FBQyxJQUE0QixDQUFDO0lBRWxELElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNWLE9BQU8sSUFBSSxDQUFDLElBQUksdUJBQWMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDO0lBQ2xELENBQUM7SUFFRCxJQUFJLENBQUM7UUFDSCxNQUFNLElBQUksR0FBRyxNQUFNLGVBQU0sQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDO1lBQ2pELEtBQUssRUFBRTtnQkFDTCxJQUFJLEVBQUUsSUFBSTthQUNYO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ1YsZUFBTSxDQUFDLElBQUksQ0FBQyxrQ0FBa0MsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUN0RCxNQUFNLElBQUEsaUJBQVEsRUFDWixJQUFJLEVBQ0osNEhBQTRILENBQzdILENBQUM7WUFDRixPQUFPLEdBQUcsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQzNDLENBQUM7UUFFRCxJQUFJLEVBQUUsQ0FBQztJQUNULENBQUM7SUFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO1FBQ3hCLGVBQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxLQUFLLEVBQUUsRUFBRSwrQkFBK0IsQ0FBQyxDQUFDO1FBQ3pELElBQUksQ0FBQyxJQUFJLDRCQUFtQixDQUFDLHVCQUF1QixDQUFDLENBQUMsQ0FBQztJQUN6RCxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBaENXLFFBQUEsU0FBUyxhQWdDcEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBOZXh0RnVuY3Rpb24sIFJlcXVlc3QsIFJlc3BvbnNlIH0gZnJvbSAnZXhwcmVzcyc7XG5pbXBvcnQgeyBwcmlzbWEgfSBmcm9tICcuLi9saWIvcHJpc21hJztcbmltcG9ydCB7IHNlbmRUZXh0IH0gZnJvbSAnLi4vbGliL3R3aWxpbyc7XG5pbXBvcnQgeyBUd2lsaW9XZWJob29rUmVxdWVzdCB9IGZyb20gJy4uL2xpYi90d2lsaW8vdHlwZXMnO1xuaW1wb3J0IHsgRm9yYmlkZGVuRXJyb3IsIEludGVybmFsU2VydmVyRXJyb3IgfSBmcm9tICcuLi91dGlscy9lcnJvcnMnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi4vdXRpbHMvbG9nZ2VyJztcblxuZXhwb3J0IGNvbnN0IHdoaXRlbGlzdCA9IGFzeW5jIChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIG5leHQ6IE5leHRGdW5jdGlvbikgPT4ge1xuICBpZiAocHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCcpIHtcbiAgICByZXR1cm4gbmV4dCgpO1xuICB9XG5cbiAgY29uc3QgeyBXYUlkIH0gPSByZXEuYm9keSBhcyBUd2lsaW9XZWJob29rUmVxdWVzdDtcblxuICBpZiAoIVdhSWQpIHtcbiAgICByZXR1cm4gbmV4dChuZXcgRm9yYmlkZGVuRXJyb3IoJ1VuYXV0aG9yaXplZCcpKTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgdXNlciA9IGF3YWl0IHByaXNtYS51c2VyV2hpdGVsaXN0LmZpbmRVbmlxdWUoe1xuICAgICAgd2hlcmU6IHtcbiAgICAgICAgd2FJZDogV2FJZCxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBpZiAoIXVzZXIpIHtcbiAgICAgIGxvZ2dlci5pbmZvKGBVbmF1dGhvcml6ZWQgYWNjZXNzIGF0dGVtcHQgYnkgJHtXYUlkfWApO1xuICAgICAgYXdhaXQgc2VuZFRleHQoXG4gICAgICAgIFdhSWQsXG4gICAgICAgIFwiSGV5ISBUaGFua3MgZm9yIHlvdXIgaW50ZXJlc3QgaW4gQnJvYWR3YXkuIFdlJ3JlIGN1cnJlbnRseSBpbiBhIHByaXZhdGUgYmV0YS4gV2UnbGwgbGV0IHlvdSBrbm93IHdoZW4gd2UncmUgcmVhZHkgZm9yIHlvdSFcIixcbiAgICAgICk7XG4gICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLnNlbmQoJ0ZvcmJpZGRlbicpO1xuICAgIH1cblxuICAgIG5leHQoKTtcbiAgfSBjYXRjaCAoZXJyb3I6IHVua25vd24pIHtcbiAgICBsb2dnZXIuZXJyb3IoeyBlcnJvciB9LCAnRXJyb3IgaW4gd2hpdGVsaXN0IG1pZGRsZXdhcmUnKTtcbiAgICBuZXh0KG5ldyBJbnRlcm5hbFNlcnZlckVycm9yKCdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InKSk7XG4gIH1cbn07XG4iXX0=