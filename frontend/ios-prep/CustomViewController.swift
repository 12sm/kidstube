import UIKit
import Capacitor
import WebKit

class CustomViewController: CAPBridgeViewController {

    override func webViewConfiguration() -> WKWebViewConfiguration {
        let config = super.webViewConfiguration()
        // Allow unmuted autoplay — this is the sole reason for the native wrapper.
        // Without this, YouTube iframe embeds behave like Safari and require a
        // user tap before sound plays.
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsInlineMediaPlayback = true
        config.allowsAirPlayForMediaPlayback = false
        return config
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.bounces = false
        webView?.scrollView.alwaysBounceVertical = false
        webView?.scrollView.pinchGestureRecognizer?.isEnabled = false
    }
}
