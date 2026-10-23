Pod::Spec.new do |s|
  s.name           = 'SkycotSpeech'
  s.version        = '1.0.0'
  s.summary        = 'On-device voice typing for SKYCOT.'
  s.description    = 'Turns speech into words with Apple Speech, on this device only.'
  s.author         = 'Curble Pty Ltd'
  s.homepage       = 'https://www.skycot.com'
  s.license        = { :type => 'Proprietary', :text => 'Copyright (c) 2026 Curble Pty Ltd, trading as SKYCOT.' }
  s.platforms      = { :ios => '18.0' }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Speech', 'AVFoundation'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
