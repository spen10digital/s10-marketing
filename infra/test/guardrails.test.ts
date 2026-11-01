import { App, Aspects, Stack } from 'aws-cdk-lib';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { describe, expect, it } from 'vitest';
import { Guardrails } from '../lib/guardrails';

const errorsFor = (build: (stack: Stack) => void) => {
  const app = new App();
  const stack = new Stack(app, 'Probe');
  build(stack);
  Aspects.of(app).add(new Guardrails());
  app.synth();
  return Annotations.fromStack(stack)
    .findError('*', Match.anyValue())
    .map((e) => String(e.entry.data));
};

describe('Guardrails', () => {
  it('flags log groups without retention', () => {
    const errors = errorsFor((s) => new logs.LogGroup(s, 'Logs', { retention: logs.RetentionDays.INFINITE }));
    expect(errors).toEqual(['Every log group needs a retention period.']);
  });

  it('accepts log groups with retention', () => {
    expect(
      errorsFor((s) => new logs.LogGroup(s, 'Logs', { retention: logs.RetentionDays.ONE_MONTH })),
    ).toEqual([]);
  });

  it('flags NAT gateways', () => {
    const errors = errorsFor((s) => new ec2.Vpc(s, 'Vpc', { natGateways: 1, maxAzs: 1 }));
    expect(errors.some((e) => e.startsWith('NAT gateways are not allowed'))).toBe(true);
  });
});
