use ic_asset_certification::{Asset, AssetConfig, AssetFallbackConfig, AssetRouter};
use ic_http_certification::{HttpRequest, HttpResponse, StatusCode};
use std::cell::RefCell;
thread_local! {static ROUTER:RefCell<AssetRouter<'static>> = RefCell::new(AssetRouter::default());}
fn setup() {
    let files: [(&str, &str, &[u8]); 9] = [
        (
            "index.html",
            "text/html; charset=utf-8",
            include_bytes!("frontend/index.html"),
        ),
        (
            "watch.css",
            "text/css; charset=utf-8",
            include_bytes!("frontend/dist/watch.css"),
        ),
        (
            "watch.js",
            "application/javascript",
            include_bytes!("frontend/dist/watch.js"),
        ),
        (
            "assets/gh0st-watch-mark.svg",
            "image/svg+xml",
            include_bytes!("frontend/assets/gh0st-watch-mark.svg"),
        ),
        (
            "assets/gh0st-watch-icon.svg",
            "image/svg+xml",
            include_bytes!("frontend/assets/gh0st-watch-icon.svg"),
        ),
        (
            "assets/armillary.jpg",
            "image/jpeg",
            include_bytes!("frontend/assets/armillary.jpg"),
        ),
        (
            "assets/editorial-normal.woff2",
            "font/woff2",
            include_bytes!("frontend/assets/editorial-normal.woff2"),
        ),
        (
            "assets/editorial-italic.woff2",
            "font/woff2",
            include_bytes!("frontend/assets/editorial-italic.woff2"),
        ),
        (
            "assets/manrope.woff2",
            "font/woff2",
            include_bytes!("frontend/assets/manrope.woff2"),
        ),
    ];
    ROUTER.with_borrow_mut(|router|{
        let mut assets=Vec::new();let mut configs=Vec::new();
        for (name,mime,bytes) in files{
            assets.push(Asset::new(name,bytes));
            configs.push(AssetConfig::File{path:name.into(),content_type:Some(mime.into()),headers:vec![
                ("Cache-Control".into(),"no-cache".into()),("X-Content-Type-Options".into(),"nosniff".into()),("Referrer-Policy".into(),"no-referrer".into()),
                ("Content-Security-Policy".into(),"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://api.dexscreener.com https://api.geckoterminal.com https://api.github.com https://icp-api.io https://rpc.mainnet.chain.robinhood.com https://rpc.testnet.chain.robinhood.com https://robinhoodchain.blockscout.com https://explorer.testnet.chain.robinhood.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'".into())],
                fallback_for:if name=="index.html"{vec![AssetFallbackConfig{scope:"/".into(),status_code:Some(StatusCode::NOT_FOUND)}]}else{vec![]},
                aliased_by:if name=="index.html"{vec!["/".into()]}else{vec![]},encodings:vec![]});
        }
        router.certify_assets(assets,configs).expect("certify web assets");
        ic_cdk::api::certified_data_set(router.root_hash());
    });
}
#[ic_cdk::init]
fn init() {
    setup();
}
#[ic_cdk::pre_upgrade]
fn before_upgrade() {
    crate::interpretation::save_cache();
}
#[ic_cdk::post_upgrade]
fn upgraded() {
    crate::interpretation::restore_cache();
    setup();
}
#[ic_cdk::query]
fn http_request(request: HttpRequest<'_>) -> HttpResponse<'static> {
    let certificate = ic_cdk::api::data_certificate().expect("query certificate");
    ROUTER.with_borrow(|router| {
        router
            .serve_asset(&certificate, &request)
            .expect("serve certified asset")
    })
}
