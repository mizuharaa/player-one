import type {
  BankCode,
  QueryTxnResult,
  TransferFundInput,
  TransferFundResult,
  VerifyAccountInput,
  VerifyAccountResult,
  ZaloPayClient,
} from '../../../src/payout/domain/client-contract.ts';

/**
 * A hand-written ZaloPay, for the domain tests.
 *
 * Not Agent A's fake server: that speaks the wire and needs the client in
 * front of it. This speaks the §2.2 seam directly, which is the boundary this
 * domain is written against, and it counts. The counts are the assertions
 * that matter most in the payout system — "how many transfers were sent" is
 * the question every double-pay and every lost-answer test ends with.
 *
 * Every answer is a scenario the test sets: a value, or a function of the
 * call (and, for queries, of how many times that order has been asked about,
 * so a test can say "processing twice, then success").
 */
type Answer<In, Out> = Out | ((input: In, nth: number) => Out | Promise<Out>);

const answer = async <In, Out>(a: Answer<In, Out>, input: In, nth: number): Promise<Out> =>
  typeof a === 'function' ? await (a as (i: In, n: number) => Out | Promise<Out>)(input, nth) : a;

export class StubZaloPay implements ZaloPayClient {
  calls = { verifyAccount: 0, transferFund: 0, queryTransaction: 0, balance: 0, bankCodes: 0 };
  /** Every transfer request, in order. The double-pay tests read its length. */
  transfers: TransferFundInput[] = [];
  queries: string[] = [];
  private queriesPerOrder = new Map<string, number>();

  verify: Answer<VerifyAccountInput, VerifyAccountResult> = {
    kind: 'verified',
    verifiedName: 'NGUYEN VAN A',
    mUId: 'mu-0001',
  };
  transfer: Answer<TransferFundInput, TransferFundResult> = (input) => ({
    kind: 'accepted',
    zlpOrderId: `zlp-${input.partnerOrderId}`,
    status: 3,
  });
  query: Answer<string, QueryTxnResult> = (partnerOrderId) => ({
    kind: 'found',
    status: 1,
    zlpOrderId: `zlp-${partnerOrderId}`,
    zpTransId: `zp-${partnerOrderId}`,
    amountVnd: null,
    resultUrl: null,
  });
  balanceVnd: number | (() => number | Promise<number>) = 100_000_000;
  banks: BankCode[] = [{ bankCode: 'VCB', name: 'Vietcombank' }];

  async verifyAccount(input: VerifyAccountInput): Promise<VerifyAccountResult> {
    this.calls.verifyAccount += 1;
    return answer(this.verify, input, this.calls.verifyAccount);
  }

  async transferFund(input: TransferFundInput): Promise<TransferFundResult> {
    this.calls.transferFund += 1;
    this.transfers.push(input);
    return answer(this.transfer, input, this.calls.transferFund);
  }

  async queryTransaction(partnerOrderId: string): Promise<QueryTxnResult> {
    this.calls.queryTransaction += 1;
    this.queries.push(partnerOrderId);
    const nth = (this.queriesPerOrder.get(partnerOrderId) ?? 0) + 1;
    this.queriesPerOrder.set(partnerOrderId, nth);
    return answer(this.query, partnerOrderId, nth);
  }

  async balance(): Promise<{ balanceVnd: number }> {
    this.calls.balance += 1;
    return { balanceVnd: typeof this.balanceVnd === 'function' ? await this.balanceVnd() : this.balanceVnd };
  }

  async bankCodes(): Promise<BankCode[]> {
    this.calls.bankCodes += 1;
    return this.banks;
  }
}
