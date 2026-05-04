import 'dotenv/config';
import { prisma } from '../../lib/prisma';

async function healthCheck() {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];

  // DB connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: 'database', ok: true });
  } catch (err) {
    checks.push({ name: 'database', ok: false, detail: err instanceof Error ? err.message : String(err) });
  }

  checks.push({
    name: 'anthropic_api_key',
    ok: !!process.env.ANTHROPIC_API_KEY,
    ...(process.env.ANTHROPIC_API_KEY ? {} : { detail: 'ANTHROPIC_API_KEY not set' }),
  });

  checks.push({
    name: 'openai_api_key',
    ok: !!process.env.OPENAI_API_KEY,
    ...(process.env.OPENAI_API_KEY ? {} : { detail: 'OPENAI_API_KEY not set' }),
  });

  checks.push({
    name: 'broadway_api_key',
    ok: !!process.env.BROADWAY_LIVE_API_KEY,
    ...(process.env.BROADWAY_LIVE_API_KEY ? {} : { detail: 'BROADWAY_LIVE_API_KEY not set' }),
  });

  // AutomationRun table accessible
  try {
    await prisma.automationRun.count();
    checks.push({ name: 'automation_tables', ok: true });
  } catch (err) {
    checks.push({ name: 'automation_tables', ok: false, detail: err instanceof Error ? err.message : String(err) });
  }

  const allOk = checks.every(c => c.ok);

  console.log('=== HEALTH CHECK ===');
  for (const check of checks) {
    const icon = check.ok ? '✅' : '❌';
    console.log(`${icon} ${check.name}${check.detail ? ': ' + check.detail : ''}`);
  }

  console.log(`\nOverall: ${allOk ? 'HEALTHY' : 'UNHEALTHY'}`);
  process.exit(allOk ? 0 : 1);
}

healthCheck()
  .finally(() => prisma.$disconnect())
  .catch(err => {
    console.error('Health check error:', err);
    process.exit(1);
  });
