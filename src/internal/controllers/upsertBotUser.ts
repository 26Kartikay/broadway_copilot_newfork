// src/internal/controllers/upsertBotUser.ts
import { AgeGroup, Fit, Gender } from '@prisma/client'; // Import Prisma enum types
import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';

// Helper function to map string to Gender enum
const mapToGender = (value: string | undefined): Gender | undefined => {
  if (!value) return undefined;
  switch (value.toLowerCase()) {
    case 'male':
      return Gender.MALE;
    case 'female':
      return Gender.FEMALE;
    case 'other':
      return Gender.OTHER;
    default:
      return undefined;
  }
};

// Helper function to map string to AgeGroup enum
const mapToAgeGroup = (value: string | undefined): AgeGroup | undefined => {
  if (!value) return undefined;
  switch (value.toLowerCase()) {
    case 'teen':
      return AgeGroup.TEEN;
    case 'adult':
      return AgeGroup.ADULT;
    case 'senior':
      return AgeGroup.SENIOR;
    default:
      return undefined;
  }
};

// Helper function to map string to Fit enum
const mapToFit = (value: string | undefined): Fit | undefined => {
  if (!value) return undefined;
  switch (value.toLowerCase()) {
    case 'low':
      return Fit.LOW;
    case 'medium':
      return Fit.MEDIUM;
    case 'high':
      return Fit.HIGH;
    default:
      return undefined;
  }
};

export const upsertBotUser = async (req: Request, res: Response) => {
  try {
    const {
      appUserId,
      phoneNumber,
      name,
      statedGender,
      statedAge,
      statedBudget,
      isVibeComplete,
      isOnboardingComplete,
      lastUpdatedAt,
    } = req.body;

    if (!appUserId || !lastUpdatedAt) {
      return res.status(400).json({ error: 'appUserId and lastUpdatedAt are required' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { appUserId },
    });

    // Idempotency check
    if (existingUser && existingUser.syncVersion && existingUser.syncVersion >= lastUpdatedAt) {
      return res.status(200).json({ message: 'User data is already up to date or newer.' });
    }

    const userData: any = {
      appUserId: appUserId,
      whatsappId: phoneNumber, // Assuming whatsappId maps to phone_number
      profileName: name,
      confirmedGender: mapToGender(statedGender), // Use mapping function
      confirmedAgeGroup: mapToAgeGroup(statedAge), // Use mapping function
      fitPreference: mapToFit(statedBudget), // Use mapping function
      // Add other mirrored fields as needed
      lastSyncedAt: new Date(),
      syncVersion: lastUpdatedAt,
    };

    const user = await prisma.user.upsert({
      where: { appUserId },
      update: userData,
      create: userData,
    });

    // Convert BigInts to strings for JSON serialization
    const serializableUser = {
      ...user,
      syncVersion: user.syncVersion?.toString(),
      // Add other BigInt fields if any
    };

    return res.status(200).json(serializableUser);
  } catch (error) {
    console.error('Error upserting bot user:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
