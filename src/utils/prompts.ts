import { promises as fsp } from 'fs';
import path from 'path';

import { InternalServerError } from './errors';

let personaContent: string | null = null; // Cache for persona.txt content

/**
 * Loads a prompt template from prompts directory by filename.
 * Prepends the global persona defined in prompts/core/persona.txt to the loaded prompt by default.
 * @param filename The name of the prompt file.
 * @param options Optional settings, e.g., { prependPersona: false } to skip prepending persona.
 */
export async function loadPrompt(
  filename: string,
  options?: { prependPersona?: boolean }
): Promise<string> {
  const { prependPersona = true } = options || {};

  let currentPersonaContent = '';
  if (prependPersona) {
    // Load persona content once and cache it
    if (personaContent === null) {
      const personaPath = path.resolve(process.cwd(), 'prompts', 'core', 'persona.txt');
      try {
        personaContent = await fsp.readFile(personaPath, 'utf-8');
      } catch (err: unknown) {
        throw new InternalServerError(`Persona file not found or unreadable: ${personaPath}`, {
          cause: err,
        });
      }
    }
    currentPersonaContent = personaContent + '\n\n';
  }

  const promptPath = path.resolve(process.cwd(), 'prompts', filename);

  try {
    const content = await fsp.readFile(promptPath, 'utf-8');
    // Conditionally prepend persona content to the loaded prompt
    return currentPersonaContent + content;
  } catch (err: unknown) {
    throw new InternalServerError(`Prompt file not found or unreadable: ${promptPath}`, {
      cause: err,
    });
  }
}
