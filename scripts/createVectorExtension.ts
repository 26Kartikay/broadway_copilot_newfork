import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createVectorExtension() {
  try {
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('Vector extension created successfully.');
  } catch (error: any) {
    // Extension might already exist, which is fine
    if (error.message?.includes('already exists')) {
      console.log('Vector extension already exists (this is OK).');
    } else {
      console.error('Error creating vector extension:', error.message);
      // Don't exit with error - Prisma db push might handle it
    }
  } finally {
    await prisma.$disconnect();
  }
}

createVectorExtension();


