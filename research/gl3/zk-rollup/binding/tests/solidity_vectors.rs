use gl3_zk_binding::*;
use serde_json::Value;
fn hex(s:&str)->Vec<u8>{let s=s.strip_prefix("0x").unwrap();assert_eq!(s.len()%2,0);(0..s.len()).step_by(2).map(|i|u8::from_str_radix(&s[i..i+2],16).unwrap()).collect()}
fn hash(s:&str)->Hash{hex(s).try_into().unwrap()}
fn vectors()->Value{serde_json::from_str(&std::fs::read_to_string(std::env::var("GL3_SOLIDITY_VECTORS").unwrap()).unwrap()).unwrap()}
fn field(v:&Value,name:&str)->Hash{hash(v[name].as_str().unwrap())}

#[test]
fn actual_solidity_statement_roundtrip_and_rejections(){
    let v=vectors();let bytes=hex(v["values"].as_str().unwrap());let s=Statement::decode(&bytes).unwrap();assert_eq!(&s.encode()[..],&bytes[..]);
    assert_eq!(s.version[31],1);assert_eq!(s.transition_index,1);assert_eq!(s.after.cursor,[1,0]);
    for i in [2,9,10,15,16,17,18,20,21]{let mut bad=bytes.clone();bad[i*32]=1;assert_eq!(Statement::decode(&bad),Err(Error::Padding));}
    assert_eq!(Statement::decode(&[0;160]),Err(Error::Length));let mut trailing=bytes;trailing.push(0);assert_eq!(Statement::decode(&trailing),Err(Error::Length));
}
#[test]
fn actual_solidity_prefix_commitments_and_wire_tampering(){
    let v=vectors();let s=Statement::decode(&hex(v["values"].as_str().unwrap())).unwrap();
    let dw=hex(v["delayedWire"].as_str().unwrap());let da=field(&v,"delayedAcc");
    let dr=authenticate_delayed(0,&dw,[0;32],da).unwrap();
    let delay=delayed_range(s.domain,0,1,delayed_seed(s.domain),&[dr]).unwrap();assert_eq!(delay.commitment,field(&v,"delayCommit"));
    let first=hex(v["firstWire"].as_str().unwrap());let second=hex(v["secondWire"].as_str().unwrap());
    let fa=field(&v,"firstAcc");let sa=field(&v,"secondAcc");
    let r0=authenticate_sequencer(0,&first,[0;32],da,fa).unwrap();let r1=authenticate_sequencer(1,&second,fa,da,sa).unwrap();
    assert_eq!(sequencer_range(s.domain,0,2,sequencer_seed(s.domain),&[r0,r1]).unwrap().commitment,field(&v,"seqCommit"));
    assert!(sequencer_range(s.domain,0,2,sequencer_seed(s.domain),&[r1,r0]).is_err());assert!(sequencer_range(s.domain,0,2,sequencer_seed(s.domain),&[r0]).is_err());
    assert!(delayed_range(s.domain,0,1,[0;32],&[dr]).is_err());
    for byte in [0,13,32,40,48,81,112,117]{let mut bad=dw.clone();bad[byte]^=1;assert!(authenticate_delayed(0,&bad,[0;32],da).is_err());}
    let mut bad=dw;bad[1]=1;assert_eq!(authenticate_delayed(0,&bad,[0;32],da).unwrap_err(),Error::Padding);
    for flag in [0x80,0x88,0x50,0x01,0x20]{let mut bad=second.clone();bad[40]=flag;assert_eq!(authenticate_sequencer(1,&bad,fa,da,sa).unwrap_err(),Error::Format);}
    assert!(authenticate_sequencer(1,&second,fa,[0;32],sa).is_err());
    assert!(authenticate_delayed(1,&first,[0;32],da).is_err());
}
