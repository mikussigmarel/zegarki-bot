import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

let prisma = null;
let isInMemory = false;

const inMemoryStore = {
  zegarki: [],
  zakupy: [],
  sprzedaze: []
};

try {
  prisma = new PrismaClient();
} catch (err) {
  console.warn('⚠️ Błąd inicjalizacji Prisma, przełączanie na in-memory mode:', err.message);
  isInMemory = true;
}

export const getDb = () => {
  return { prisma, isInMemory, store: inMemoryStore };
};

export default prisma;
