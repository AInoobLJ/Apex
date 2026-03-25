import axios from 'axios';
import { logger } from '../lib/logger';
import { logApiUsage } from './api-usage-logger';

const RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
const CTF_ADDRESS = process.env.POLYMARKET_CTF_ADDRESS || '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';

// ERC-1155 TransferSingle event topic
const TRANSFER_SINGLE_TOPIC = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
// ERC-1155 TransferBatch event topic
const TRANSFER_BATCH_TOPIC = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';

export interface TransferEvent {
  txHash: string;
  blockNumber: number;
  from: string;
  to: string;
  tokenId: string;
  amount: number;
  timestamp?: number;
}

/**
 * Fetch ERC-1155 transfer logs from Polymarket CTF Exchange on Polygon.
 */
export async function fetchTransferLogs(fromBlock: number, toBlock: number): Promise<TransferEvent[]> {
  if (!RPC_URL || RPC_URL === 'https://polygon-rpc.com') {
    logger.debug('POLYGON_RPC_URL not configured, skipping on-chain fetch');
    return [];
  }

  const start = Date.now();
  try {
    const response = await axios.post(RPC_URL, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getLogs',
      params: [{
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
        address: CTF_ADDRESS,
        topics: [[TRANSFER_SINGLE_TOPIC, TRANSFER_BATCH_TOPIC]],
      }],
    }, { timeout: 30000 });

    await logApiUsage({
      service: 'polygon',
      endpoint: 'eth_getLogs',
      latencyMs: Date.now() - start,
      statusCode: 200,
    });

    const logs = response.data.result || [];
    return logs.map((log: any) => parseTransferLog(log)).filter(Boolean);
  } catch (err) {
    await logApiUsage({
      service: 'polygon',
      endpoint: 'eth_getLogs',
      latencyMs: Date.now() - start,
      statusCode: 0,
    });
    logger.error(err, 'Polygon getLogs failed');
    return [];
  }
}

function parseTransferLog(log: any): TransferEvent | null {
  try {
    const topics = log.topics || [];
    const isSingle = topics[0] === TRANSFER_SINGLE_TOPIC;

    if (isSingle && topics.length >= 4) {
      const from = '0x' + topics[2].slice(26);
      const to = '0x' + topics[3].slice(26);
      const data = log.data.slice(2);
      const tokenId = BigInt('0x' + data.slice(0, 64)).toString();
      const amount = Number(BigInt('0x' + data.slice(64, 128)));

      return {
        txHash: log.transactionHash,
        blockNumber: parseInt(log.blockNumber, 16),
        from,
        to,
        tokenId,
        amount,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the latest block number on Polygon.
 */
export async function getLatestBlock(): Promise<number> {
  if (!RPC_URL || RPC_URL === 'https://polygon-rpc.com') return 0;

  try {
    const response = await axios.post(RPC_URL, {
      jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [],
    }, { timeout: 10000 });
    return parseInt(response.data.result, 16);
  } catch {
    return 0;
  }
}
