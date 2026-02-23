import { AgeGroup, Fit, Gender, PendingType } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { isGuestUser } from '../../utils/user';
import { GraphState } from '../state';

/**
 * Extracts and persists confirmed user profile fields from a button payload.
 * Resets pending state to NONE when complete.
 */
export async function recordUserInfo(state: GraphState): Promise<GraphState> {
  const userId = state.user.id;
  const buttonPayload = state.input.ButtonPayload;

  if (!buttonPayload) {
    logger.warn(
      { userId },
      'recordUserInfo called without a button payload. This may happen if the user types their answer. The current implementation only handles button clicks for this flow.',
    );
    // Do nothing and let the conversation continue. The profile will be updated on the next relevant action.
    return { ...state, pending: PendingType.NONE };
  }

  try {
    const [field, ...valueParts] = buttonPayload.split('_');
    const value = valueParts.join('_');

    let dataToUpdate: {
      confirmedGender?: Gender;
      confirmedAgeGroup?: AgeGroup;
      fitPreference?: Fit;
    } = {};

    if (field === 'gender' && value !== 'skip') {
      if (Object.values(Gender).includes(value as Gender)) {
        dataToUpdate.confirmedGender = value as Gender;
      } else {
        logger.warn({ userId, value }, 'Invalid gender value received from button payload.');
      }
    } else if (field === 'age') {
      if (Object.values(AgeGroup).includes(value as AgeGroup)) {
        dataToUpdate.confirmedAgeGroup = value as AgeGroup;
      } else {
        logger.warn({ userId, value }, 'Invalid age group value received from button payload.');
      }
    } else if (field === 'fit') {
      if (Object.values(Fit).includes(value as Fit)) {
        dataToUpdate.fitPreference = value as Fit;
      } else {
        logger.warn({ userId, value }, 'Invalid fit value received from button payload.');
      }
    }

    // In production, do NOT update database - database is source of truth
    // However, we MUST update state.user so the current conversation flow works correctly
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (Object.keys(dataToUpdate).length > 0) {
      if (isProduction || isGuestUser(state.user)) {
        logger.debug(
          { userId, updatedFields: Object.keys(dataToUpdate) },
          'Skipping database update (production or guest). Updating state.user for current conversation.',
        );
        // Update state.user object so the current conversation flow works
        const updatedUser = {
          ...state.user,
          ...dataToUpdate,
        };
        return { ...state, user: updatedUser, pending: PendingType.NONE };
      }
      const user = await prisma.user.update({
        where: { id: state.user.id },
        data: dataToUpdate,
      });
      logger.debug(
        { userId, updatedFields: Object.keys(dataToUpdate) },
        'User info recorded successfully from button payload',
      );
      return { ...state, user, pending: PendingType.NONE };
    }

    logger.debug({ userId, buttonPayload }, 'User may have skipped providing info.');
    return { ...state, pending: PendingType.NONE };
  } catch (err: unknown) {
    throw new InternalServerError('Failed to record user info from button payload', { cause: err });
  }
}
