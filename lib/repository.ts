import { Stack, StackProps } from 'aws-cdk-lib';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

export class RepositoryStack extends Stack {
  public readonly websocketRepo: Repository;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.websocketRepo = new Repository(this, 'WebSocketRepo', {
      repositoryName: 'websocket-gateway',
    });
  }
}