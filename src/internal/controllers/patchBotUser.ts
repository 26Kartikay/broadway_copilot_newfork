// src/internal/controllers/patchBotUser.ts
import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { Gender, AgeGroup, Fit } from '@prisma/client'; // Import Prisma enum types

// Helper function to map string to Gender enum
const mapToGender = (value: string | undefined): Gender | undefined => {
  if (!value) return undefined;
  switch (value.toLowerCase()) {
    case 'male': return Gender.MALE;
    case 'female': return Gender.FEMALE;
    case 'other': return Gender.OTHER;
    default: return undefined;
  }
};

// Helper function to map string to AgeGroup enum
const mapToAgeGroup = (value: string | undefined): AgeGroup | undefined => {
  if (!value) return undefined;
  switch (value.toLowerCase()) {
    case 'teen': return AgeGroup.TEEN;
    case 'adult': return AgeGroup.ADULT;
    case 'senior': return AgeGroup.SENIOR;
    default: return undefined;
  }
};

// Helper function to map string to Fit enum
const mapToFit = (value: string | undefined): Fit | undefined => {
  if (!value) return undefined;
  switch (value.toLowerCase()) {
    case 'low': return Fit.LOW;
    case 'medium': return Fit.MEDIUM;
    case 'high': return Fit.HIGH;
    default: return undefined;
  }
};

export const patchBotUser = async (req: Request, res: Response) => {
  try {
    const { appUserId } = req.params;
    const { lastUpdatedAt, ...updatedFields } = req.body;

    if (!appUserId || !lastUpdatedAt) {
      return res.status(400).json({ error: 'appUserId and lastUpdatedAt are required' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { appUserId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Idempotency check
    if (existingUser.syncVersion && existingUser.syncVersion >= lastUpdatedAt) {
      return res.status(200).json({ message: 'User data is already up to date or newer.' });
    }

    // Filter out bot-owned inferred fields from being updated by app
    const allowedFields: Record<string, any> = {};
    for (const key in updatedFields) {
      // These are the fields the app is allowed to update
      if ([
        'phoneNumber', 'name', 'statedGender', 'statedAge', 'statedBudget',
        'isVibeComplete', 'isOnboardingComplete'
      ].includes(key)) {
        // Map incoming names to Prisma schema names
        switch (key) {
          case 'phoneNumber':
            allowedFields.whatsappId = updatedFields[key];
            break;
          case 'name':
            allowedFields.profileName = updatedFields[key];
            break;
          case 'statedGender':
            allowedFields.confirmedGender = mapToGender(updatedFields[key]); // Use mapping function
            break;
          case 'statedAge':
            allowedFields.confirmedAgeGroup = mapToAgeGroup(updatedFields[key]); // Use mapping function
            break;
          case 'statedBudget':
            allowedFields.fitPreference = mapToFit(updatedFields[key]); // Use mapping function
            break;
          default:
            allowedFields[key] = updatedFields[key];
            break;
        }
      }
    }

    // Update lastSyncedAt and syncVersion
    allowedFields.lastSyncedAt = new Date();
    allowedFields.syncVersion = lastUpdatedAt;

    const user = await prisma.user.update({
      where: { appUserId },
      data: allowedFields,
    });

    // Convert BigInts to strings for JSON serialization
    const serializableUser = {
      ...user,
      syncVersion: user.syncVersion?.toString(),
      // Add other BigInt fields if any
    };

    res.status(200).json(serializableUser);
  } catch (error) {
    console.error('Error patching bot user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
