use ic_asset_certification::{Asset, AssetConfig, AssetFallbackConfig, AssetRouter};
use ic_http_certification::{HttpRequest, HttpResponse, StatusCode};
use std::cell::RefCell;
thread_local! {static ROUTER:RefCell<AssetRouter<'static>> = RefCell::new(AssetRouter::default());}
fn setup() {
    let files: [(&str, &str, &[u8]); 3] = [
        (
            "index.html",
            "text/html; charset=utf-8",
            include_bytes!("frontend/index.html"),
        ),
        (
            "watch.css",
            "text/css; charset=utf-8",
            include_bytes!("frontend/watch.css"),
        ),
        (
            "watch.js",
            "application/javascript",
            include_bytes!("frontend/dist/watch.js"),
        ),
    ];
    ROUTER.with_borrow_mut(|router|{
        let mut assets=Vec::new();let mut configs=Vec::new();
        for (name,mime,bytes) in files{
            assets.push(Asset::new(name,bytes));
            configs.push(AssetConfig::File{path:name.into(),content_type:Some(mime.into()),headers:vec![
                ("Cache-Control".into(),"no-cache".into()),("X-Content-Type-Options".into(),"nosniff".into()),("Referrer-Policy".into(),"no-referrer".into()),
                ("Content-Security-Policy".into(),"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://icp-api.io https://rpc.mainnet.chain.robinhood.com https://rpc.testnet.chain.robinhood.com https://robinhoodchain.blockscout.com https://explorer.testnet.chain.robinhood.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'".into())],
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
#[ic_cdk::post_upgrade]
fn upgraded() {
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
