"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPrompt = loadPrompt;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const errors_1 = require("./errors");
async function loadPrompt(filename) {
    const promptPath = path_1.default.resolve(process.cwd(), 'prompts', filename);
    try {
        const content = await fs_1.promises.readFile(promptPath, 'utf-8');
        return content;
    }
    catch (err) {
        throw new errors_1.InternalServerError(`Prompt file not found or unreadable: ${promptPath}`, {
            cause: err,
        });
    }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy91dGlscy9wcm9tcHRzLnRzIiwic291cmNlcyI6WyIvdXNyL3NyYy9hcHAvc3JjL3V0aWxzL3Byb21wdHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFTQSxnQ0FXQztBQXBCRCwyQkFBcUM7QUFDckMsZ0RBQXdCO0FBRXhCLHFDQUErQztBQU14QyxLQUFLLFVBQVUsVUFBVSxDQUFDLFFBQWdCO0lBQy9DLE1BQU0sVUFBVSxHQUFHLGNBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxFQUFFLFNBQVMsRUFBRSxRQUFRLENBQUMsQ0FBQztJQUVwRSxJQUFJLENBQUM7UUFDSCxNQUFNLE9BQU8sR0FBRyxNQUFNLGFBQUcsQ0FBQyxRQUFRLENBQUMsVUFBVSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQ3hELE9BQU8sT0FBTyxDQUFDO0lBQ2pCLENBQUM7SUFBQyxPQUFPLEdBQVksRUFBRSxDQUFDO1FBQ3RCLE1BQU0sSUFBSSw0QkFBbUIsQ0FBQyx3Q0FBd0MsVUFBVSxFQUFFLEVBQUU7WUFDbEYsS0FBSyxFQUFFLEdBQUc7U0FDWCxDQUFDLENBQUM7SUFDTCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHByb21pc2VzIGFzIGZzcCB9IGZyb20gJ2ZzJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuXG5pbXBvcnQgeyBJbnRlcm5hbFNlcnZlckVycm9yIH0gZnJvbSAnLi9lcnJvcnMnO1xuXG4vKipcbiAqIExvYWRzIGEgcHJvbXB0IHRlbXBsYXRlIGZyb20gcHJvbXB0cyBkaXJlY3RvcnkgYnkgZmlsZW5hbWUuXG4gKiBAcGFyYW0gZmlsZW5hbWUgVGhlIG5hbWUgb2YgdGhlIHByb21wdCBmaWxlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZFByb21wdChmaWxlbmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgcHJvbXB0UGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAncHJvbXB0cycsIGZpbGVuYW1lKTtcblxuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBmc3AucmVhZEZpbGUocHJvbXB0UGF0aCwgJ3V0Zi04Jyk7XG4gICAgcmV0dXJuIGNvbnRlbnQ7XG4gIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgIHRocm93IG5ldyBJbnRlcm5hbFNlcnZlckVycm9yKGBQcm9tcHQgZmlsZSBub3QgZm91bmQgb3IgdW5yZWFkYWJsZTogJHtwcm9tcHRQYXRofWAsIHtcbiAgICAgIGNhdXNlOiBlcnIsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==