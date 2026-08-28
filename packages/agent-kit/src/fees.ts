import type {PublicClient} from "viem";

/**
 * The EIP-1559 fees a 0G transaction must carry.
 *
 * Both halves are asked of the NODE, and that is not belt-and-braces. Galileo's
 * base fee is 7 wei while its minimum priority fee is 2 gwei — nine orders of
 * magnitude apart. A client that derives the tip from the base fee, as most
 * defaults do, is rejected outright; one that sets only the tip is rejected the
 * other way, for a priority fee above its own ceiling. Both failures cost a
 * round trip and read as "the RPC is broken".
 */
export interface Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/**
 * @param headroom multiplies the tip when forming the ceiling, so a base fee
 *        that rises between quoting and mining does not strand the transaction.
 */
export async function suggestFees(client: PublicClient, headroom = 2n): Promise<Fees> {
  const [tip, block] = await Promise.all([
    client.request({method: "eth_maxPriorityFeePerGas"}) as Promise<`0x${string}`>,
    client.getBlock(),
  ]);
  const maxPriorityFeePerGas = BigInt(tip);
  const baseFee = block.baseFeePerGas ?? 0n;
  return {
    maxPriorityFeePerGas,
    // The ceiling must exceed the tip, or the node rejects the transaction
    // before it looks at anything else.
    maxFeePerGas: maxPriorityFeePerGas * headroom + baseFee,
  };
}
