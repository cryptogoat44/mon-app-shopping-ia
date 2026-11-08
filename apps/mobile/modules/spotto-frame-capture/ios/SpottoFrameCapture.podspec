Pod::Spec.new do |s|
  s.name           = 'SpottoFrameCapture'
  s.version        = '1.0.0'
  s.summary        = 'Spotto: frame of the built-in player'
  s.description    = 'Local module of Spotto (built-in player lot): picture of the web view, or one screen frame through ReplayKit.'
  s.author         = 'Spotto'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.frameworks     = 'WebKit', 'PDFKit', 'ReplayKit', 'CoreImage', 'CoreMedia'

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
