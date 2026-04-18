import { Construct } from 'constructs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { FargateService, ICluster } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { createAlarms } from './alarms';
import { createDashboard } from './dashboard';

/**
 * Inputs for the WebSocketGatewayObservability construct.
 *
 * All wiring-specific inputs (service, cluster, alb) are optional so this
 * construct can be instantiated from different stack flavors (ECS Fargate
 * today, EKS in the future). When an input is provided, the corresponding
 * alarms/widgets are created; when omitted, they are skipped.
 */
export interface WebSocketGatewayObservabilityProps {
  /** The ECS Fargate service hosting the WebSocket gateway (ECS stack). */
  service?: FargateService;
  /** The ECS cluster that runs the service (ECS stack). */
  cluster?: ICluster;
  /** The ALB fronting the gateway (ECS stack). */
  alb?: ApplicationLoadBalancer;
  /** SNS topic to route alarm notifications to. */
  snsTopic: sns.Topic;
  /** Custom metrics namespace (reserved for future use; defaults preserved). */
  metricsNamespace?: string;
}

/**
 * L2 construct that encapsulates CloudWatch alarms and the operational
 * dashboard for the WebSocket gateway.
 *
 * Note on logical-ID preservation: the underlying alarm/dashboard L1
 * resources are created on the *parent* scope (`scope`), not on `this`.
 * This keeps their CloudFormation logical IDs identical to the pre-refactor
 * layout (e.g. `MemoryUtilizationAlarm...` rather than
 * `ObservabilityMemoryUtilizationAlarm...`), so a `cdk deploy` after this
 * refactor will NOT recreate existing alarms/dashboards. The construct
 * itself exists only as an organizational wrapper in the tree.
 */
export class WebSocketGatewayObservability extends Construct {
  public readonly dashboard?: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: WebSocketGatewayObservabilityProps) {
    super(scope, id);

    // Create dashboard on the parent scope (preserves logical ID).
    if (props.service && props.cluster && props.alb) {
      this.dashboard = createDashboard(scope, {
        ecsService: props.service,
        ecsCluster: props.cluster,
        alb: props.alb,
      });
    }

    // Create alarms on the parent scope (preserves logical IDs).
    if (props.service) {
      createAlarms(scope, props.service, props.snsTopic);
    }
  }
}
