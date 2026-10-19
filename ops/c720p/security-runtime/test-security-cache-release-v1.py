#!/usr/bin/env python3
"""Pure cache contract tests. No device/file/HA writes or service operations."""
import copy
import unittest
import security_cache_release_v1 as cache


class SecurityCacheReleaseTests(unittest.TestCase):
    def test_html_updates_only_requested_script_and_keeps_extra_query_bytes(self):
        for name, target in cache.HTML_SCRIPTS.items():
            with self.subTest(name=name):
                before = ('<!doctype html>\r\n<meta http-equiv="Cache-Control" content="no-store">\r\n'
                          '<script data-src="' + target + '?v=unused-data-attribute"></script>\r\n'
                          '<script defer data-feature="KEEP" src="' + target + '?mode=a%20b&v=old&flag=#anchor"></script>\r\n'
                          '<script src="/local/independent.js?v=other-owner"></script>\r\n')
                if name == 'c720p-surveillance.html':
                    before += '<script id="s9-night-visibility-v1" src="'+cache.NIGHT_SCRIPT+'?v=old-night"></script>\r\n'
                after = cache.patch_asset(name, before)
                expected = before.replace('v=old', 'v=' + cache.RELEASE, 1)
                if name == 'c720p-surveillance.html':
                    expected = expected.replace('v=old-night', 'v='+cache.RELEASE, 1)
                self.assertEqual(after, expected)
                self.assertEqual(cache.patch_asset(name, after), after)
                self.assertEqual(before.count('\r\n'), after.count('\r\n'))

    def test_inner_shell_night_key_changes_only_if_present_and_outer_requires_it(self):
        hub = '<script src="'+cache.HTML_SCRIPTS['security-hub-v30.html']+'?v=hub-old"></script>'
        night = '<script src="'+cache.NIGHT_SCRIPT+'?v=night-old"></script>'
        self.assertEqual(cache.patch_asset('security-hub-v30.html', hub+night),
                         (hub+night).replace('hub-old',cache.RELEASE).replace('night-old',cache.RELEASE))
        self.assertNotIn(cache.NIGHT_SCRIPT,cache.patch_asset('security-hub-v30.html',hub))
        with self.assertRaisesRegex(ValueError,'expected_one_security_script_reference'):
            cache.patch_asset('c720p-surveillance.html',hub)
        with self.assertRaisesRegex(ValueError,'expected_one_security_script_reference'):
            cache.patch_asset('security-hub-v30.html',hub+night+night)

    def test_html_unknown_or_duplicate_reference_refuses_to_guess(self):
        target = cache.HTML_SCRIPTS['c720p-surveillance.html']
        script = '<script src="' + target + '?v=old"></script>'
        for source in ('<script src="/unrelated.js?v=x"></script>', script + script):
            with self.subTest(source=source):
                with self.assertRaisesRegex(ValueError, 'expected_one_security_script_reference'):
                    cache.patch_asset('c720p-surveillance.html', source)

    def test_hub_suffix_changes_without_replacing_tab_routes_or_new_features(self):
        before = ("const $=id=>document.getElementById(id),asset='/local/frontyard-security-new/',version='v=person-presence-v44b-20261017';\n"
                  "const tabs=[['faces','People','◎','security-people-v50.html?v=other-release&']];\n"
                  "function nativeCaptureDiagnostics(d){return d.continuous_4k_ready;}\n")
        after = cache.patch_asset('security-hub-v30.js', before)
        self.assertEqual(after, before.replace("version='v=person-presence-v44b-20261017'", "version='v=" + cache.RELEASE + "'"))
        self.assertEqual(cache.patch_hub_js(after), after)
        for source in ('const version="something-new";', before + before):
            with self.assertRaisesRegex(ValueError, 'expected_one_security_child_version'):
                cache.patch_hub_js(source)

    def dashboard(self):
        return {'version':1, 'minor_version':1, 'key':'lovelace.c720p_hub', 'data':{'config':{
            'title':'Hub', 'views':[
                {'path':'home','cards':[{'type':'iframe','url':cache.ENTRY+'?v=home-owned','aspect_ratio':'56%'}]},
                {'path':'front-yard-security','title':'Security','icon':'mdi:shield','cards':[{'type':'vertical-stack','cards':[
                    {'type':'iframe','url':cache.ENTRY+'?layout=a%20b&v=old#security','aspect_ratio':'56%'},
                    {'type':'iframe','url':'/local/other-security.html?v=independent'}]}]},
                {'path':'climate','cards':[{'type':'entities','entities':['sensor.room']}]}]}}}

    def test_deep_dashboard_preserves_original_and_every_other_value(self):
        original = self.dashboard()
        frozen = copy.deepcopy(original)
        changed = cache.patch_dashboard(original)
        expected = copy.deepcopy(original)
        expected['data']['config']['views'][1]['cards'][0]['cards'][0]['url'] = cache.ENTRY+'?layout=a%20b&v='+cache.RELEASE+'#security'
        self.assertEqual(original, frozen, 'pure function must not mutate supplied dashboard')
        self.assertEqual(changed, expected)
        self.assertEqual(cache.patch_dashboard(changed), changed)
        self.assertIsNot(changed['data']['config']['views'][0], original['data']['config']['views'][0])

    def test_bare_config_and_only_verified_actual_view_path(self):
        bare = self.dashboard()['data']['config']
        changed = cache.patch_dashboard(bare)
        self.assertIn('v='+cache.RELEASE, changed['views'][1]['cards'][0]['cards'][0]['url'])
        self.assertEqual(bare['views'][0], changed['views'][0])
        bare['views'][1]['path'] = 'garden-security'
        with self.assertRaisesRegex(ValueError, 'expected_one_security_view'):
            cache.patch_dashboard(bare)

    def test_ambiguous_dashboard_and_foreign_entry_refuse_to_modify(self):
        duplicate = self.dashboard()
        duplicate['data']['config']['views'].append(copy.deepcopy(duplicate['data']['config']['views'][1]))
        with self.assertRaisesRegex(ValueError, 'expected_one_security_view'):
            cache.patch_dashboard(duplicate)
        duplicate = self.dashboard()
        stack = duplicate['data']['config']['views'][1]['cards'][0]['cards']
        stack.append(copy.deepcopy(stack[0]))
        with self.assertRaisesRegex(ValueError, 'expected_one_security_entry_iframe'):
            cache.patch_dashboard(duplicate)
        foreign = self.dashboard()
        foreign['data']['config']['views'][1]['cards'][0]['cards'][0]['url'] = 'https://foreign.invalid'+cache.ENTRY+'?v=old'
        with self.assertRaisesRegex(ValueError, 'unexpected_security_asset_url'):
            cache.patch_dashboard(foreign)

    def test_url_duplicate_encoded_missing_and_unsafe_keys_fail_closed(self):
        for suffix in ('?v=one&v=two', '?%76=encoded', '?mode=only', ''):
            with self.subTest(suffix=suffix):
                with self.assertRaises(ValueError):
                    cache.release_url(cache.ENTRY+suffix, cache.ENTRY)
        for release in ('', 'bad&key=x', 'bad/key', None, 'x'*81):
            with self.subTest(release=release):
                with self.assertRaisesRegex(ValueError, 'invalid_security_release_key'):
                    cache.release_url(cache.ENTRY+'?v=old', cache.ENTRY, release)
        with self.assertRaisesRegex(ValueError, 'unsupported_security_cache_asset'):
            cache.patch_asset('other-owners.js', 'unchanged')


if __name__ == '__main__':
    unittest.main()
