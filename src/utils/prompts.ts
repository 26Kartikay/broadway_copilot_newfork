import { promises as fsp } from 'fs';
import path from 'path';

import { User } from '@prisma/client'; // Import User type

import { InternalServerError } from './errors';

let personaContent: string | null = null; // Cache for persona.txt content

/**
 * Loads a prompt template from prompts directory by filename.
 * Prepends the global persona defined in prompts/core/persona.txt to the loaded prompt by default.
 * @param filename The name of the prompt file.
 * @param user Optional: The user object to personalize the persona.
 * @param options Optional settings, e.g., { prependPersona: false } to skip prepending persona.
 */
export async function loadPrompt(
  filename: string,
  user?: User, // Accept optional User object
  options?: { prependPersona?: boolean },
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
    
    // Replace placeholders with user data
    let personalizedPersona = personaContent;
    if (user) {
      personalizedPersona = personalizedPersona
        .replace('{USER_NAME}', user.profileName || 'there')
        .replace('{USER_GENDER}', user.confirmedGender || 'not specified')
        .replace('{USER_AGE_GROUP}', user.confirmedAgeGroup || 'not specified')
        .replace('{USER_FIT_PREFERENCE}', user.fitPreference || 'not specified');
    } else {
      // Replace with default values if no user object is provided
      personalizedPersona = personalizedPersona
        .replace('{USER_NAME}', 'there')
        .replace('{USER_GENDER}', 'not specified')
        .replace('{USER_AGE_GROUP}', 'not specified')
        .replace('{USER_FIT_PREFERENCE}', 'not specified');
    }

    currentPersonaContent = personalizedPersona + '\n\n';
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
