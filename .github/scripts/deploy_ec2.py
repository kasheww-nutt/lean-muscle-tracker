"""Deploy one verified version to two ALB targets through AWS OIDC/SSM."""
import json
import os
import re
import subprocess
import time


def aws(*arguments):
    result = subprocess.run(['aws', *arguments, '--output', 'json'], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout or '{}')


def instance_ids(value):
    ids = [part.strip() for part in value.split(',') if part.strip()]
    if len(ids) != 2 or len(set(ids)) != 2 or any(not re.fullmatch(r'i-(?:[0-9a-f]{8}|[0-9a-f]{17})', i) for i in ids):
        raise ValueError('EC2_INSTANCE_IDS must contain exactly two distinct instance IDs separated by a comma.')
    return ids


def ssm(instance, command, timeout=1200):
    response = aws('ssm', 'send-command', '--instance-ids', instance, '--document-name', 'AWS-RunShellScript',
                   '--parameters', json.dumps({'commands': [command], 'executionTimeout': [str(timeout)]}))
    command_id = response['Command']['CommandId']
    deadline = time.monotonic() + timeout + 60
    while time.monotonic() < deadline:
        try:
            response = aws('ssm', 'get-command-invocation', '--command-id', command_id, '--instance-id', instance)
        except RuntimeError as error:
            if 'InvocationDoesNotExist' not in str(error):
                raise
            time.sleep(5)
            continue
        status = response['Status']
        if status == 'Success':
            return response.get('StandardOutputContent', '')
        if status in ('Failed', 'Cancelled', 'TimedOut', 'Cancelling'):
            # Scripts do not print environment secrets. Surface the failed phase, not full private output.
            raise RuntimeError(f'SSM command {command_id} failed on {instance}: {status}. Inspect private SSM logs.')
        time.sleep(5)
    raise RuntimeError(f'SSM command timed out on {instance}.')


def health(group, ids):
    result = aws('elbv2', 'describe-target-health', '--target-group-arn', group)
    return {entry['Target']['Id']: entry['TargetHealth']['State'] for entry in result['TargetHealthDescriptions']
            if entry['Target']['Id'] in ids and entry['Target'].get('Port', 5173) == 5173}


def wait_state(group, instance, state, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        current = health(group, [instance]).get(instance, 'unused')
        if current == state:
            return
        time.sleep(5)
    raise RuntimeError(f'Target {instance} did not become {state}.')


def prefix():
    # Optional Compose TLS overlay mounts the same trusted DB CA in app and backup utility.
    return ('set -eu; cd /opt/lean-muscle-tracker; '
            'export TRACKER_ENV_FILE=/opt/lean-muscle-tracker.env TRACKER_BIND_ADDRESS=0.0.0.0; '
            'if [ -f /opt/lean-muscle-tracker.ca.pem ]; then '
            'export TRACKER_DATABASE_CA_PATH=/opt/lean-muscle-tracker.ca.pem; '
            'export COMPOSE_FILE=docker-compose.yml:docker-compose.tls.yml; fi; ')


def deploy(ids, sha, group):
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Invalid deployment SHA.')
    if not re.fullmatch(r'arn:aws[a-z-]*:elasticloadbalancing:[a-z0-9-]+:\d{12}:targetgroup/[A-Za-z0-9-]+/[0-9a-f]+', group):
        raise ValueError('Invalid ALB_TARGET_GROUP_ARN.')
    fingerprints = []
    for instance in ids:
        print(f'Staging verified version on {instance}', flush=True)
        output = ssm(instance, prefix() + 'git fetch origin main; git checkout --detach ' + sha +
                     '; docker compose build tracker db-tools; docker compose run --rm --no-deps tracker node scripts/config-fingerprint.mjs')
        matches = re.findall(r'^TRACKER_SHARED_CONFIG=([0-9a-f]{64})$', output, re.MULTILINE)
        if len(matches) != 1:
            raise RuntimeError('Unable to verify shared configuration on ' + instance)
        fingerprints.append(matches[0])
    if len(set(fingerprints)) != 1:
        raise RuntimeError('Replica DB/owner/session/OAuth/Cognito configuration differs. No target was replaced.')
    print('Shared configuration agrees; applying serialized migrations.', flush=True)
    # One backup on the shared DB; absent initial schema is handled without a fake backup claim.
    ssm(ids[0], prefix() + 'if docker compose run --rm --no-deps tracker node scripts/schema-exists.mjs; then '
        'docker compose run --rm --no-deps db-tools /tools/backup.sh; '
        'else status=$?; [ "$status" -eq 42 ] || exit "$status"; fi; '
        'docker compose run --rm --no-deps tracker node scripts/migrate.mjs')
    initial = health(group, ids)
    # Repair an unhealthy target first so the healthy target remains in service.
    ordered = sorted(ids, key=lambda i: initial.get(i) == 'healthy')
    for instance in ordered:
        statuses = health(group, ids)
        other = next(i for i in ids if i != instance)
        if statuses.get(instance) == 'healthy' and statuses.get(other) != 'healthy':
            raise RuntimeError('Refusing to drain the only healthy application target.')
        print(f'Draining and updating {instance}; other target state: {statuses.get(other, "unused")}', flush=True)
        aws('elbv2', 'deregister-targets', '--target-group-arn', group, '--targets', f'Id={instance},Port=5173')
        try:
            wait_state(group, instance, 'unused', 480)
            ssm(instance, prefix() + 'docker compose up -d --no-build --wait --wait-timeout 180 tracker; '
                'curl --fail --silent http://127.0.0.1:5173/api/health')
        finally:
            # Restore registration even after failure; target health protects the surviving healthy replica.
            aws('elbv2', 'register-targets', '--target-group-arn', group, '--targets', f'Id={instance},Port=5173')
        wait_state(group, instance, 'healthy', 180)
    print('Both application targets are healthy at the verified version.', flush=True)


if __name__ == '__main__':
    deploy(instance_ids(os.environ['EC2_INSTANCE_IDS']), os.environ['DEPLOY_SHA'], os.environ['ALB_TARGET_GROUP_ARN'])
