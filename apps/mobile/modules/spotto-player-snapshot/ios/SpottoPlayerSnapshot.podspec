Pod::Spec.new do |s|
  s.name           = 'SpottoPlayerSnapshot'
  s.version        = '1.0.0'
  s.summary        = 'Local module: snapshot of the built-in player web view (WKWebView.takeSnapshot only).'
  s.description    = 'Local module of the app (video links mission): pauses the media of the player web view, then takes a snapshot of what the view shows. Nothing else: no screen recording, no PDF, no network.'
  s.author         = 'App'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.frameworks     = 'WebKit', 'UIKit'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,swift}"
end
