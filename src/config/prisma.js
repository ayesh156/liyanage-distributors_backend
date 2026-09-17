// Universal Prisma instance එක කෙලින්ම re-export කිරීම
import prisma from '../lib/prisma.ts';

export * from '../lib/prisma.ts';
export default prisma;