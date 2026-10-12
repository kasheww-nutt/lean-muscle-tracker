"""Exercise rolling deployment decisions without issuing AWS calls."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy_ec2', Path(__file__).resolve().parents[1] / '.github/scripts/deploy_ec2.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
IDS = ['i-0123456789abcdef0', 'i-0123456789abcdef1']
SHA = 'a' * 40
GROUP = 'arn:aws:elasticloadbalancing:ap-south-1:123456789012:targetgroup/tracker/0123456789abcdef'
FINGERPRINT = 'TRACKER_SHARED_CONFIG=' + 'b' * 64

class RollingDeployTests(unittest.TestCase):
    def test_requires_two_distinct_ids(self):
        self.assertEqual(deploy.instance_ids(','.join(IDS)), IDS)
        for value in (IDS[0], ','.join([IDS[0], IDS[0]]), ','.join(IDS + ['i-01234567']), 'bad,ids'):
            with self.assertRaises(ValueError):
                deploy.instance_ids(value)

    def test_configuration_mismatch_never_drains_or_migrates(self):
        with patch.object(deploy, 'ssm', side_effect=[FINGERPRINT, 'TRACKER_SHARED_CONFIG=' + 'c' * 64]) as ssm, patch.object(deploy, 'aws') as aws:
            with self.assertRaisesRegex(RuntimeError, 'configuration differs'):
                deploy.deploy(IDS, SHA, GROUP)
            self.assertEqual(ssm.call_count, 2)
            aws.assert_not_called()

    def test_unhealthy_replica_is_repaired_before_healthy_one(self):
        states = [{IDS[0]: 'healthy', IDS[1]: 'unhealthy'}, {IDS[0]: 'healthy', IDS[1]: 'unhealthy'}, dict.fromkeys(IDS, 'healthy')]
        with patch.object(deploy, 'ssm', return_value=FINGERPRINT) as ssm, patch.object(deploy, 'aws') as aws, patch.object(deploy, 'health', side_effect=states), patch.object(deploy, 'wait_state') as wait:
            deploy.deploy(IDS, SHA, GROUP)
            drained = [call.args[-1] for call in aws.call_args_list if call.args[1] == 'deregister-targets']
            self.assertEqual(drained, [f'Id={IDS[1]},Port=5173', f'Id={IDS[0]},Port=5173'])
            self.assertEqual(wait.call_count, 4)
            self.assertIn('scripts/migrate.mjs', ssm.call_args_list[2].args[1])
            self.assertEqual(sum('scripts/migrate.mjs' in call.args[1] for call in ssm.call_args_list), 1)

    def test_never_drains_last_healthy_target(self):
        with patch.object(deploy, 'ssm', return_value=FINGERPRINT), patch.object(deploy, 'aws') as aws, patch.object(deploy, 'health', side_effect=[dict.fromkeys(IDS, 'healthy'), {IDS[0]: 'healthy', IDS[1]: 'unhealthy'}]):
            with self.assertRaisesRegex(RuntimeError, 'only healthy'):
                deploy.deploy(IDS, SHA, GROUP)
            aws.assert_not_called()

    def test_failed_update_registers_target_and_stops_rollout(self):
        with patch.object(deploy, 'ssm', side_effect=[FINGERPRINT, FINGERPRINT, '', RuntimeError('restart failed')]), patch.object(deploy, 'aws') as aws, patch.object(deploy, 'health', return_value=dict.fromkeys(IDS, 'healthy')), patch.object(deploy, 'wait_state'):
            with self.assertRaisesRegex(RuntimeError, 'restart failed'):
                deploy.deploy(IDS, SHA, GROUP)
            self.assertEqual([call.args[1] for call in aws.call_args_list], ['deregister-targets', 'register-targets'])
            self.assertTrue(all(f'Id={IDS[0]},Port=5173' in call.args for call in aws.call_args_list))

    def test_initial_boot_can_start_unregistered_targets(self):
        with patch.object(deploy, 'ssm', return_value=FINGERPRINT), patch.object(deploy, 'aws') as aws, patch.object(deploy, 'health', side_effect=[{}, {}, {IDS[0]: 'healthy'}]), patch.object(deploy, 'wait_state'):
            deploy.deploy(IDS, SHA, GROUP)
            self.assertEqual(sum(call.args[1] == 'register-targets' for call in aws.call_args_list), 2)

if __name__ == '__main__':
    unittest.main()
