/**
 * The npm package ships no .d.ts for the ./impl/browser subpath (0.11.9).
 * Minimal ambient typing mirroring impl/nodejs — see NOTES.md §12.
 */
declare module '@unicitylabs/sphere-sdk/impl/browser' {
  import type {
    StorageProvider,
    TransportProvider,
    OracleProvider,
    TokenStorageProvider,
    TxfStorageDataBase,
    PriceProvider,
    MarketModuleConfig,
    GroupChatModuleConfig,
  } from '@unicitylabs/sphere-sdk';

  export interface BrowserProvidersConfig {
    network: 'testnet' | 'testnet2' | 'mainnet' | 'dev';
    debug?: boolean;
    storage?: { prefix?: string };
    transport?: { relays?: string[]; additionalRelays?: string[]; timeout?: number };
    oracle?: { url?: string; apiKey?: string; timeout?: number };
    price?: { platform: string; apiKey?: string };
    market?: MarketModuleConfig | boolean;
    groupChat?: GroupChatModuleConfig | boolean;
  }

  // Mirrors createNodeProviders' return (base ports the wallet-api layer extends).
  export interface BrowserProviders {
    storage: StorageProvider;
    transport: TransportProvider;
    oracle: OracleProvider;
    tokenStorage: TokenStorageProvider<TxfStorageDataBase>;
    price?: PriceProvider;
    market?: MarketModuleConfig | boolean;
    groupChat?: GroupChatModuleConfig | boolean;
  }

  export function createBrowserProviders(config: BrowserProvidersConfig): BrowserProviders;
}
