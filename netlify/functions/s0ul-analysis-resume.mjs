import { requireProduction, dispatchBackground } from './lib/analysis-runtime.mjs';

export default async (_request,context) => {
  requireProduction(context);await dispatchBackground(context);
};
// Every minute in UTC; only the published production deployment runs schedules.
export const config={schedule:'* * * * *'};
