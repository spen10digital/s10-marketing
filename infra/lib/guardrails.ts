import { Annotations, CfnResource, type IAspect } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';

/**
 * Cost and hygiene guardrails from CLAUDE.md: no NAT gateways, no RDS Proxy, and no log
 * group without retention. Violations fail `cdk synth` as errors.
 */
const FORBIDDEN: Record<string, string> = {
  'AWS::EC2::NatGateway': 'NAT gateways are not allowed (02 §14); components reach AWS over IAM + HTTPS.',
  'AWS::RDS::DBProxy':
    'RDS Proxy is not allowed: it blocks Aurora auto-pause and the Data API makes it unnecessary.',
};

export class Guardrails implements IAspect {
  visit(node: IConstruct): void {
    if (!(node instanceof CfnResource)) return;
    const reason = FORBIDDEN[node.cfnResourceType];
    if (reason) Annotations.of(node).addError(reason);

    if (node.cfnResourceType === 'AWS::Logs::LogGroup') {
      const props = (node as unknown as { retentionInDays?: number }).retentionInDays;
      if (props === undefined) Annotations.of(node).addError('Every log group needs a retention period.');
    }
  }
}
