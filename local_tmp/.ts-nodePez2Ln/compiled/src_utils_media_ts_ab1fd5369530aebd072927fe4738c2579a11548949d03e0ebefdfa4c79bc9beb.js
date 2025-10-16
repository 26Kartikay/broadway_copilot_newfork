"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadTwilioMedia = downloadTwilioMedia;
const crypto_1 = require("crypto");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const mime_types_1 = require("mime-types");
const errors_1 = require("./errors");
const logger_1 = require("./logger");
const paths_1 = require("./paths");
const twilioAuth = {
    sid: process.env.TWILIO_ACCOUNT_SID || '',
    token: process.env.TWILIO_AUTH_TOKEN || '',
};
async function downloadTwilioMedia(url, whatsappId, mimeType) {
    if (!twilioAuth.sid || !twilioAuth.token) {
        throw new errors_1.InternalServerError('Twilio credentials missing');
    }
    if (!mimeType) {
        throw new errors_1.BadRequestError('MIME type is required');
    }
    try {
        const extension = (0, mime_types_1.extension)(mimeType);
        const filename = `twilio_${(0, crypto_1.randomUUID)()}${extension ? `.${extension}` : ''}`;
        const response = await fetch(url, {
            headers: {
                Authorization: `Basic ${Buffer.from(`${twilioAuth.sid}:${twilioAuth.token}`).toString('base64')}`,
            },
        });
        if (!response.ok) {
            throw new errors_1.InternalServerError(`Failed to download media: ${response.status}`);
        }
        const uploadDir = (0, paths_1.userUploadDir)(whatsappId);
        await (0, paths_1.ensureDir)(uploadDir);
        const filePath = path_1.default.join(uploadDir, filename);
        const buffer = Buffer.from(await response.arrayBuffer());
        await promises_1.default.writeFile(filePath, buffer);
        const baseUrl = process.env.SERVER_URL?.replace(/\/$/, '') || '';
        const publicUrl = `${baseUrl}/uploads/${whatsappId}/${filename}`;
        logger_1.logger.debug({ whatsappId, filename, filePath, mimeType, size: buffer.length }, 'Twilio media downloaded and saved');
        return publicUrl;
    }
    catch (err) {
        throw new errors_1.InternalServerError('Failed to download Twilio media', {
            cause: err,
        });
    }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy91dGlscy9tZWRpYS50cyIsInNvdXJjZXMiOlsiL3Vzci9zcmMvYXBwL3NyYy91dGlscy9tZWRpYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQXNCQSxrREE0Q0M7QUFsRUQsbUNBQW9DO0FBQ3BDLDJEQUE2QjtBQUM3QixnREFBd0I7QUFFeEIsMkNBQXNEO0FBRXRELHFDQUFnRTtBQUNoRSxxQ0FBa0M7QUFDbEMsbUNBQW1EO0FBRW5ELE1BQU0sVUFBVSxHQUFHO0lBQ2pCLEdBQUcsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixJQUFJLEVBQUU7SUFDekMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLElBQUksRUFBRTtDQUMzQyxDQUFDO0FBU0ssS0FBSyxVQUFVLG1CQUFtQixDQUN2QyxHQUFXLEVBQ1gsVUFBa0IsRUFDbEIsUUFBZ0I7SUFFaEIsSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDekMsTUFBTSxJQUFJLDRCQUFtQixDQUFDLDRCQUE0QixDQUFDLENBQUM7SUFDOUQsQ0FBQztJQUNELElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNkLE1BQU0sSUFBSSx3QkFBZSxDQUFDLHVCQUF1QixDQUFDLENBQUM7SUFDckQsQ0FBQztJQUNELElBQUksQ0FBQztRQUNILE1BQU0sU0FBUyxHQUFHLElBQUEsc0JBQVcsRUFBQyxRQUFRLENBQUMsQ0FBQztRQUN4QyxNQUFNLFFBQVEsR0FBRyxVQUFVLElBQUEsbUJBQVUsR0FBRSxHQUFHLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxTQUFTLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUM7UUFFN0UsTUFBTSxRQUFRLEdBQUcsTUFBTSxLQUFLLENBQUMsR0FBRyxFQUFFO1lBQ2hDLE9BQU8sRUFBRTtnQkFDUCxhQUFhLEVBQUUsU0FBUyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsVUFBVSxDQUFDLEdBQUcsSUFBSSxVQUFVLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLEVBQUU7YUFDbEc7U0FDRixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQ2pCLE1BQU0sSUFBSSw0QkFBbUIsQ0FBQyw2QkFBNkIsUUFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7UUFDaEYsQ0FBQztRQUVELE1BQU0sU0FBUyxHQUFHLElBQUEscUJBQWEsRUFBQyxVQUFVLENBQUMsQ0FBQztRQUM1QyxNQUFNLElBQUEsaUJBQVMsRUFBQyxTQUFTLENBQUMsQ0FBQztRQUMzQixNQUFNLFFBQVEsR0FBRyxjQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxRQUFRLENBQUMsQ0FBQztRQUNoRCxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sUUFBUSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUM7UUFDekQsTUFBTSxrQkFBRSxDQUFDLFNBQVMsQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFFckMsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDakUsTUFBTSxTQUFTLEdBQUcsR0FBRyxPQUFPLFlBQVksVUFBVSxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQ2pFLGVBQU0sQ0FBQyxLQUFLLENBQ1YsRUFBRSxVQUFVLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLE1BQU0sQ0FBQyxNQUFNLEVBQUUsRUFDakUsbUNBQW1DLENBQ3BDLENBQUM7UUFFRixPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBQUMsT0FBTyxHQUFZLEVBQUUsQ0FBQztRQUN0QixNQUFNLElBQUksNEJBQW1CLENBQUMsaUNBQWlDLEVBQUU7WUFDL0QsS0FBSyxFQUFFLEdBQUc7U0FDWCxDQUFDLENBQUM7SUFDTCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IGZzIGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuXG5pbXBvcnQgeyBleHRlbnNpb24gYXMgZXh0RnJvbU1pbWUgfSBmcm9tICdtaW1lLXR5cGVzJztcblxuaW1wb3J0IHsgQmFkUmVxdWVzdEVycm9yLCBJbnRlcm5hbFNlcnZlckVycm9yIH0gZnJvbSAnLi9lcnJvcnMnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi9sb2dnZXInO1xuaW1wb3J0IHsgZW5zdXJlRGlyLCB1c2VyVXBsb2FkRGlyIH0gZnJvbSAnLi9wYXRocyc7XG5cbmNvbnN0IHR3aWxpb0F1dGggPSB7XG4gIHNpZDogcHJvY2Vzcy5lbnYuVFdJTElPX0FDQ09VTlRfU0lEIHx8ICcnLFxuICB0b2tlbjogcHJvY2Vzcy5lbnYuVFdJTElPX0FVVEhfVE9LRU4gfHwgJycsXG59O1xuXG4vKipcbiAqIERvd25sb2FkcyBtZWRpYSBmcm9tIFR3aWxpbyBhbmQgc2F2ZXMgaXQgbG9jYWxseVxuICogQHBhcmFtIHVybCAtIFR3aWxpbyBtZWRpYSBVUkxcbiAqIEBwYXJhbSB3aGF0c2FwcElkIC0gV2hhdHNBcHAgSUQgZm9yIHVzZXIgZGlyZWN0b3J5XG4gKiBAcGFyYW0gbWltZVR5cGUgLSBNSU1FIHR5cGUgKGUuZy4sICdpbWFnZS9qcGVnJylcbiAqIEByZXR1cm5zIFB1YmxpYyBVUkwgdG8gdGhlIGRvd25sb2FkZWQgZmlsZVxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZG93bmxvYWRUd2lsaW9NZWRpYShcbiAgdXJsOiBzdHJpbmcsXG4gIHdoYXRzYXBwSWQ6IHN0cmluZyxcbiAgbWltZVR5cGU6IHN0cmluZyxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGlmICghdHdpbGlvQXV0aC5zaWQgfHwgIXR3aWxpb0F1dGgudG9rZW4pIHtcbiAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcignVHdpbGlvIGNyZWRlbnRpYWxzIG1pc3NpbmcnKTtcbiAgfVxuICBpZiAoIW1pbWVUeXBlKSB7XG4gICAgdGhyb3cgbmV3IEJhZFJlcXVlc3RFcnJvcignTUlNRSB0eXBlIGlzIHJlcXVpcmVkJyk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBleHRlbnNpb24gPSBleHRGcm9tTWltZShtaW1lVHlwZSk7XG4gICAgY29uc3QgZmlsZW5hbWUgPSBgdHdpbGlvXyR7cmFuZG9tVVVJRCgpfSR7ZXh0ZW5zaW9uID8gYC4ke2V4dGVuc2lvbn1gIDogJyd9YDtcblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIEF1dGhvcml6YXRpb246IGBCYXNpYyAke0J1ZmZlci5mcm9tKGAke3R3aWxpb0F1dGguc2lkfToke3R3aWxpb0F1dGgudG9rZW59YCkudG9TdHJpbmcoJ2Jhc2U2NCcpfWAsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEludGVybmFsU2VydmVyRXJyb3IoYEZhaWxlZCB0byBkb3dubG9hZCBtZWRpYTogJHtyZXNwb25zZS5zdGF0dXN9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgdXBsb2FkRGlyID0gdXNlclVwbG9hZERpcih3aGF0c2FwcElkKTtcbiAgICBhd2FpdCBlbnN1cmVEaXIodXBsb2FkRGlyKTtcbiAgICBjb25zdCBmaWxlUGF0aCA9IHBhdGguam9pbih1cGxvYWREaXIsIGZpbGVuYW1lKTtcbiAgICBjb25zdCBidWZmZXIgPSBCdWZmZXIuZnJvbShhd2FpdCByZXNwb25zZS5hcnJheUJ1ZmZlcigpKTtcbiAgICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZVBhdGgsIGJ1ZmZlcik7XG5cbiAgICBjb25zdCBiYXNlVXJsID0gcHJvY2Vzcy5lbnYuU0VSVkVSX1VSTD8ucmVwbGFjZSgvXFwvJC8sICcnKSB8fCAnJztcbiAgICBjb25zdCBwdWJsaWNVcmwgPSBgJHtiYXNlVXJsfS91cGxvYWRzLyR7d2hhdHNhcHBJZH0vJHtmaWxlbmFtZX1gO1xuICAgIGxvZ2dlci5kZWJ1ZyhcbiAgICAgIHsgd2hhdHNhcHBJZCwgZmlsZW5hbWUsIGZpbGVQYXRoLCBtaW1lVHlwZSwgc2l6ZTogYnVmZmVyLmxlbmd0aCB9LFxuICAgICAgJ1R3aWxpbyBtZWRpYSBkb3dubG9hZGVkIGFuZCBzYXZlZCcsXG4gICAgKTtcblxuICAgIHJldHVybiBwdWJsaWNVcmw7XG4gIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgIHRocm93IG5ldyBJbnRlcm5hbFNlcnZlckVycm9yKCdGYWlsZWQgdG8gZG93bmxvYWQgVHdpbGlvIG1lZGlhJywge1xuICAgICAgY2F1c2U6IGVycixcbiAgICB9KTtcbiAgfVxufVxuIl19