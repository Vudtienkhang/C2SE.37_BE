import prisma from './prisma/prisma.js';

async function checkMandatory() {
  try {
    const list = await prisma.knowledgeQuiz.findMany({
      where: { isActive: true, isMandatory: true }
    });
    console.log('Mandatory Quizzes:', list.length);
    list.forEach(q => console.log(`- ${q.name}`));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
checkMandatory();
