class Saku < Formula
  desc "Local encrypted password manager with a web UI"
  homepage "https://github.com/haiigas/homebrew-saku"
  url "https://github.com/haiigas/homebrew-saku/archive/refs/tags/v0.1.9.tar.gz"
  sha256 "479a4deafd3f6bbb4f3e905088d2d137041b69d75dc5168cf520807c55eb7622"
  license "MIT"

  depends_on "go" => :build
  depends_on "mkcert"

  def install
    system "go", "build", *std_go_args
    pkgshare.install "extension"
  end

  service do
    run [opt_bin/"saku", "serve"]
    keep_alive true
    log_path var/"log/saku.log"
    error_log_path var/"log/saku.log"
  end

  def caveats
    <<~EOS
      Open https://localhost:7878 (run `saku serve` or `brew services start saku`).
      saku runs `mkcert -install` itself for a trusted HTTPS cert (it may ask for your password once).
      If the browser still warns, run it manually: mkcert -install
      Chrome extension: chrome://extensions > Developer mode > Load unpacked >
        #{opt_pkgshare}/extension
      Your encrypted vault lives in ~/.config/saku/vault.db
      Remove all of it with:
        brew uninstall --zap saku
    EOS
  end

  def zap
    rm_rf "#{Dir.home}/.config/saku"
  end

  test do
    assert_match "saku 0.1.9", shell_output("#{bin}/saku --version")
  end
end
