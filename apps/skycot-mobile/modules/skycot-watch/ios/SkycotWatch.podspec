Pod::Spec.new do |s|
  s.name           = 'SkycotWatch'
  s.version        = '1.0.0'
  s.summary        = 'SKYCOT on a grown-up\'s Apple Watch: the iPhone side.'
  s.description    = 'WatchConnectivity between the SKYCOT iPhone app and its Watch app, and the notifications the Watch can answer.'
  s.author         = 'Curble Pty Ltd'
  s.homepage       = 'https://www.skycot.com'
  s.license        = { :type => 'Proprietary', :text => 'Copyright (c) 2026 Curble Pty Ltd, trading as SKYCOT.' }
  # nondev-seam: skycot-watch-module-ios17-target
  s.platforms      = { :ios => '17.0' }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity', 'UserNotifications'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
