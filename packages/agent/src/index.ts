import { config } from './config.js';
import { logger } from './logger.js';
import { Store } from './db.js';
import { bootSphere, ensureBalanceFloor, ensureNametag } from './sphere.js';
import { DealService } from './dealService.js';
import { PoolService } from './pools.js';
import { IntentPublisher } from './intents.js';
import { Treasury } from './treasury.js';
import { startApi } from './api.js';

async function main(): Promise<void> {
  logger.info({ network: config.network, nametag: config.nametag }, 'notary agent starting');

  const store = new Store(config.dbPath);
  const { sphere } = await bootSphere(store);

  await ensureNametag(sphere);
  await ensureBalanceFloor(sphere);

  const deals = new DealService(sphere, store);
  deals.start();

  const pools = new PoolService(sphere, store, () => deals.runPayoutExecutor());
  await pools.start();
  deals.setGroupWatcher((groupId) => pools.watchGroup(groupId));

  const treasury = new Treasury(sphere, store);
  treasury.start();

  const intents = new IntentPublisher(sphere, store);
  await intents.start();

  const api = await startApi(sphere, store, treasury);

  logger.info(
    { nametag: sphere.identity?.nametag, api: `http://localhost:${config.apiPort}/api/status` },
    '@notary is open for business — DM me a deal.open or say help',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down gracefully');
    deals.stop();
    pools.stop();
    treasury.stop();
    intents.stop();
    await api.close().catch(() => undefined);
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'agent failed to start');
  process.exit(1);
});
