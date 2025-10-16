"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const isDevelopment = process.env.NODE_ENV === 'development';
const loggerOptions = {
    level: isDevelopment ? 'debug' : 'info',
};
if (isDevelopment) {
    loggerOptions.transport = {
        target: 'pino-pretty',
        options: {
            colorize: true,
        },
    };
}
exports.logger = (0, pino_1.default)(loggerOptions);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy91dGlscy9sb2dnZXIudHMiLCJzb3VyY2VzIjpbIi91c3Ivc3JjL2FwcC9zcmMvdXRpbHMvbG9nZ2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLGdEQUEyQztBQU0zQyxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsS0FBSyxhQUFhLENBQUM7QUFNN0QsTUFBTSxhQUFhLEdBQWtCO0lBQ25DLEtBQUssRUFBRSxhQUFhLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTTtDQUN4QyxDQUFDO0FBRUYsSUFBSSxhQUFhLEVBQUUsQ0FBQztJQUNsQixhQUFhLENBQUMsU0FBUyxHQUFHO1FBQ3hCLE1BQU0sRUFBRSxhQUFhO1FBQ3JCLE9BQU8sRUFBRTtZQUNQLFFBQVEsRUFBRSxJQUFJO1NBQ2Y7S0FDRixDQUFDO0FBQ0osQ0FBQztBQUVZLFFBQUEsTUFBTSxHQUFHLElBQUEsY0FBSSxFQUFDLGFBQWEsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHBpbm8sIHsgTG9nZ2VyT3B0aW9ucyB9IGZyb20gJ3Bpbm8nO1xuXG4vKipcbiAqIERldGVybWluZXMgaWYgdGhlIGFwcGxpY2F0aW9uIGlzIHJ1bm5pbmcgaW4gZGV2ZWxvcG1lbnQgbW9kZS5cbiAqIENvbnRyb2xzIGxvZ2dlciBjb25maWd1cmF0aW9uIGZvciBiZXR0ZXIgZGVidWdnaW5nIGV4cGVyaWVuY2UuXG4gKi9cbmNvbnN0IGlzRGV2ZWxvcG1lbnQgPSBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50JztcblxuLyoqXG4gKiBDZW50cmFsaXplZCBsb2dnZXIgaW5zdGFuY2UgdXNpbmcgUGlubyB3aXRoIGVudmlyb25tZW50LXNwZWNpZmljIGNvbmZpZ3VyYXRpb24uXG4gKiBVc2VzIHByZXR0eSBwcmludGluZyBpbiBkZXZlbG9wbWVudCBmb3IgYmV0dGVyIHJlYWRhYmlsaXR5LCBKU09OIGluIHByb2R1Y3Rpb24uXG4gKi9cbmNvbnN0IGxvZ2dlck9wdGlvbnM6IExvZ2dlck9wdGlvbnMgPSB7XG4gIGxldmVsOiBpc0RldmVsb3BtZW50ID8gJ2RlYnVnJyA6ICdpbmZvJyxcbn07XG5cbmlmIChpc0RldmVsb3BtZW50KSB7XG4gIGxvZ2dlck9wdGlvbnMudHJhbnNwb3J0ID0ge1xuICAgIHRhcmdldDogJ3Bpbm8tcHJldHR5JyxcbiAgICBvcHRpb25zOiB7XG4gICAgICBjb2xvcml6ZTogdHJ1ZSxcbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgY29uc3QgbG9nZ2VyID0gcGlubyhsb2dnZXJPcHRpb25zKTtcbiJdfQ==