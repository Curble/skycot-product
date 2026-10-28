Pod::Spec.new do |s|
  s.name           = 'SkycotDeviceKey'
  s.version        = '1.0.0'
  s.summary        = 'SKYCOT\'s Face ID key on a grown-up\'s iPhone.'
  s.description    = 'A P-256 signing key in the Secure Enclave that signs only after Face ID or Touch ID, for saying yes to a child\'s request.'
  s.author         = 'Curble Pty Ltd'
  s.homepage       = 'https://www.skycot.com'
  s.license        = { :type => 'Apache-2.0', :file => '../../../../../LICENSE-APACHE' }
  # nondev-seam: skycot-device-key-ios17-target
  s.platforms      = { :ios => '17.0' }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CryptoKit', 'LocalAuthentication', 'Security'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
