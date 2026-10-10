import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThan } from 'typeorm';
import { AnnualPackageEntity } from './annual-package.entity';
import { ContractMonthRowEntity } from './contract-month-row.entity';
import { CostMonthRowEntity } from './cost-month-row.entity';
import { MaintenanceMonthRowEntity } from './maintenance-month-row.entity';
import { MonthSnapshotEntity } from './month-snapshot.entity';
import { MonthUnlockGrantEntity } from './month-unlock-grant.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { AllocationEntity } from '../contracts/allocation.entity';
import { CityEntity } from '../cities/city.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { RequestUserScope } from '../common/security/scope';
import { PackageStatus, Role, ContractRowLockStatus, SoftDeleteFlag } from '@biz-reporting/shared-types';
import { VALID_COST_CATEGORY_CODES } from '@biz-reporting/shared-constants';
import { calculateProfitMetrics } from '../domain/finance/business-calculator';
import type {
  DraftSaveRequest,
  SubmitPreviewResponse,
  ReturnToDraftRequest,
  UnlockMonthsRequest,
  BulkUnlockMonthsRequest,
  BulkUnlockMonthsResponse,
  OpenCurrentMonthContractRequest,
  AdminPackageItem,
  PaginatedResponse,
} from '@biz-reporting/shared-types';

/** 婵犵數濮烽弫鍛婃叏閻㈠壊鏁婇柡宥庡幖缁愭淇婇妶鍛殲闁哄棙绮嶆穱濠囧Χ閸涱厽娈堕梺娲诲幗閻熲晠寮婚悢鍏煎€绘俊顖炴櫜缁爼姊洪柅鐐茶嫰婢у墽绱掗悩铏碍闁伙綁鏀辩缓鐣岀矙鐠囦勘鍔嶉妵鍕籍閸ヮ灝鎾寸箾閸涱厾效婵﹥妞介幊锟犲Χ閸涘懌鍨虹换娑氭嫚瑜忛悾鐢告煙椤曗偓缁犳牠銆侀弴銏℃櫇闁逞屽墰缁骞庨懞銉у幐闂佹悶鍎弲娑樻毄闂備礁鎼ˇ浼村箖閸屾凹娼栨繛宸簻娴肩娀鏌涢弴銊ヤ簼婵炲牊绮撳铏圭矙濞嗘儳鍓遍梺鍦焾婢ц棄危閹版澘绠虫俊銈勭娴滃綊姊洪崨濠傚閻忓繑鐟︾€电厧鐣濋崟顑芥嫼闂佸憡绻傜€氼噣鎮橀柆宥嗙厱闁绘ê纾晶鐢告煟濞戝崬娅嶇€殿喕绮欓、妯款槼闁哄拑绲介埞鎴︽偐缂佹ɑ閿梺缁橆殔濡繂鐣烽悽鍓叉晢濞达綁顥撶粻姘舵⒑缂佹ê濮﹀ù婊勭矒閸┾偓妞ゆ帊鑳舵晶閬嶆煛娓氬洤鏋涢摶鏍煕濞戝崬鏋涢柛鎿冨枛椤啴濡堕崱娆忣潷闂佸憡鍨电紞濠傜暦閻㈢鍗抽柣鏃傜節缁ㄥ姊洪崫鍕妞ゃ劌鎳忕粋宥夋倷椤掑倻鐦堢紒鐐緲椤﹁京澹曢崸妤佺厱闊洦妫戦懓璺ㄢ偓娈垮櫘閸嬪﹤鐣烽幒妤佸€烽柡澶嬪灩濡绢喖鈹戦悩顔肩伇婵炲鐩幊鐔碱敍濞戞瑥寮? 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣銏犲閺佸﹪鏌″搴″箹闂傚偆鍨遍妵鍕冀閵娧呯厐缂備浇缈伴崐婵嬪蓟閿濆鏅查柛娑卞枟閹烽亶鎮楃憴鍕闁绘搫绻濆濠氭偄鐞涒€充壕婵炴垶鐟悞鐣岀磼閻樺崬宓嗛柡灞诲€濆鍫曞箰鎼粹€叉樊闂?10 闂?18:00 */
const DEFAULT_DEADLINE_DAY = 10;
const DEFAULT_DEADLINE_HOUR = 18;

/** 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏℃櫇闁逞屽墴閹虫粏銇愰幒鎾跺幐闁诲繒鍋犻褔宕濆杈╃＜闁逞屽墴瀹曟﹢顢欓悾灞藉笚闂佸搫顦遍崑鐐寸珶閸℃稑绀夌€广儱娲ㄧ壕鍏间繆閵堝倸浜鹃梻浣稿簻缁蹭粙锝?contractRowsJson 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋涢ˇ鐢稿极閹剧粯鍋愰柤纰卞墻濡茬兘姊绘担鍛婃儓婵炲眰鍨藉畷褰掑捶椤撶姳绗夐梺缁橆焾濞呮洟宕ｈ箛鏂剧箚闁绘劙顤傞崵娆徝瑰鍫㈢暫闁诡喗顨堥幉鎾礋椤掑偆妲版繝鐢靛仜瀵墎鍒掗幘璇叉槬闁逞屽墯閵囧嫰骞掗幋婵愪痪濠电偞鍤崶銊у幍闁荤姴娉ч崨顖滄闁诲氦顫夊ú姗€宕归悽闈╃稏婵犲﹤鐗嗛悞鍨亜閹烘垵顏╃紒鐘崇墬閹便劌顪冪拠韫闂備浇顕栭崰妤呮偡閳哄懎绠栧ù鐘差儏閸ㄥ倹銇勯幇鍓佸埌闁哄懐鏁诲濠氬磼濞嗘垵濡介梺璇″枛閻栫厧鐣烽幇顑╂梹鎷呴搹璇″晭闂備線鈧偛鑻晶鎾煛瀹€鈧崰鏍€佸▎鎾村殐闁冲搫鍞妸鈺傗拺閻犲洠鈧櫕鐏嶇紓渚囧枟閹告悂鎮鹃悜钘夐唶闁哄洨鍋熼崢鎼佹⒑閸涘﹤濮屾繛澶嬫礋瀹曘儵宕烽鐘碉紳闂佺鏈懝楣冨焵椤掑嫷妫戞繛鍡愬灲閺佹捇鎮╅懠顒傚炊闂備浇顫夊畷姗€顢氳缁牊寰勯幇顓犲幍闁诲孩绋掗…鍥╃不閵夆晜鐓曢柕鍫濇缁€瀣煛瀹€鈧崰鏍ь潖閼姐倐鍋撻棃娑橆棌婵″樊鍠氱槐鎾存媴閹绘帊澹曢梺璇插嚱缂嶅棝宕板Δ鍛亗闁哄洢鍨洪悡娆撴煙鐟欏嫬濮囬柦鍕偢閺屾稖绠涢幘瀛樻嫳闂侀潧娲ょ€氫即寮崒鐐村殐闁冲搫锕ら弲顧磌nown 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇氱秴闁搞儺鍓﹂弫宥夋煟閹邦厽缍戝ù婊堜憾濮婅櫣鍖栭弴鐐测拤濡炪們鍔嶉崝娆撳箠閹捐閿ゆ俊銈勮閹峰搫顪冮妶鍡楀潑闁稿鎸剧槐鎺撳緞鐎ｎ偄鍞夐梺璇″枛濞硷繝骞冨▎鎿冩晞闁告瑣鍎抽惄搴ㄦ⒒娴ｇ瓔娼愬鐟邦儔瀵彃鈽夐姀鐘靛姦濡炪倖甯婄欢鈥斥枔濡ソ鐟邦煥閸曨剙鈧劙鏌熼鑽ょ煓鐎规洏鍔嶇换婵嬪磼濞嗗繐顕ч梻鍌氬€烽悞锕傚箖閸洖纾块柣鎴烆焽椤╁弶绻濇繝鍌滃闁稿骸绉电换娑橆啅椤旇崵鍑归梺缁樻尭閸熶即骞夌粙娆剧叆闁割偅绻勯ˇ顓㈡⒑缂佹ɑ鐓ユい鈺佹啞瀵板嫰骞囬鍌ゅ晪闂佽崵濮村ú鈺冧焊濞嗘挸绀夐柨鏇楀亾妞ゎ亜鍟存俊鍫曞幢濡ゅ啰鎳嗛梻浣侯焾閿曘倗绱炴繝鍌滄殾闁汇垻顭堥悞鍨亜閹烘垵顏柍閿嬪灩缁辨挻鎷呴惂闀愮返濠电偛鐗婂瑙勭┍婵犲浂鏁冮柨婵嗗閻や線姊虹拠鈥虫珝缂佺姵鐗犲濠氬Ω瑜夐崑鎾绘晲鎼粹€斥拫濠碉紕铏庨崳锝咁潖濞差亜宸濆┑鐘插濡插牓姊洪幐搴㈢８闁稿﹥鐗滅划瀣箳濡も偓娴肩娀鏌涢弴鐐典粵閻庨潧鐭傚娲濞戞艾顣烘俊銈囧У閹倿鎮伴鍢夋棃宕ㄩ闂寸紦婵＄偑鍊栭悧妤冨垝鐏炲墽顩风憸蹇曟?*/
type SnapshotContractRowLike = {
  contractId?: unknown;
  completionAmount?: unknown;
  acceptanceAmount?: unknown;
  invoiceAmount?: unknown;
  orderAmount?: unknown;
};

type SnapshotCostRowLike = {
  costCategoryCode?: unknown;
  amount?: unknown;
};

/**
 * 濠电姷鏁告慨鎾儉婢舵劕绾ч幖瀛樻尭娴滅偓淇婇妶鍕妽闁告瑥绻橀弻锝夊箣閿濆棭妫勭紒鐐劤椤兘寮婚敐澶婄疀妞ゆ帊璁查弸娆撴⒑缂佹ê绗╁┑顔哄€楅幑銏犫槈閵忕姴鑰垮┑鈽嗗灥濞咃絾绂嶉崼鏇熲拺缂佸顑欓崕鎰版煙閹间胶鐣烘鐐差樀楠炴﹢顢欓懖鈺婃Ч婵＄偑鍊栭崝妤呭窗閹扮増鍊堕柛鈩兠肩换鍡涙煏閸繃鎼愰崯鎼佹⒑缁嬫鍎愰柣鈺婂灦瀵粯绻濋崶銊︽珳闂佺硶鍓濆ú婊呯不濮樿埖鈷戠紓浣姑悘杈ㄤ繆椤愩垹顏柛搴亰濮婄粯鎷呴悷閭﹀殝缂備浇顕ч崐鍨暦閹版澘宸濆┑鐘插濞插憡淇婇妶蹇曞埌闁哥噥鍨堕幃锟犲即閵忥紕鍘垫繛瀵稿帶閻°劌鈽夎閺岋紕鈧綆鍋嗛妴鎺旂磼鏉堛劌娴柛鈹惧亾濡炪倖宸婚崑鎾绘煟閿濆棛绠炵€规洜鍠栭、妤呭磼濮橆剛鐤勬繝鐢靛Х閺佹悂宕戦悙鍝勫瀭闂傚牊绋撻弳锔姐亜閹烘垵顏╅柛鎴犲█閺屾洟宕煎┑鍥ь€涢梺缁樻煥濡繈寮婚敐澶嬪亜闁绘挸绨奸崰濠囨⒑缁嬪灝顒㈡俊顐㈠暣瀵鏁愭径濠勵啌闂佸憡鍔戦崝瀣窗婵犲洦鍊甸悷娆忓缁€鍐煕鎼绰板仮閽樻繈鏌＄仦璇插姕闁绘挻鐩弻娑㈠焺閸愵亝鍣ф繛瀵稿婵″洨妲愰幒鏃傜＜婵☆垵鍋愰悿鍕⒑缁洘鏉归柛瀣尭椤啴濡堕崱妤冪懆闁诲孩鍑归崜鐔煎箖濞嗘劗绡€闁告劧缂氱花濠氭⒑閻熺増鎯堟俊顐ｎ殕缁傚秹宕滆绾捐棄霉閿濆棗绲诲ù?
 *
 * 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧鏌ｉ幇顒佹儓闁搞劌鍊块弻娑㈩敃閿濆棛顦ョ紓浣哄У濠㈡﹢鍩為幋锔藉亹鐎规洖娴傞弳锟犳⒑閹肩偛鈧洟鎯岄崒鐐茶摕闁挎繂顦粻娑㈡⒒閸喓鈽夋い顐邯濮婃椽宕ㄦ繝鍕櫑缂備胶绮敃銏狀嚕婵犳碍鏅插璺猴功閻嫰姊洪幖鐐插姤婵炲鐩鏌ユ焼瀹ュ棛鍘介梺缁樻煥閹芥粓骞婇崘顔藉€垫慨妯煎帶楠炴鏌涢幒鎴含妤犵偞锕㈤、娆撴寠婢跺鎽嬪┑鐘垫暩閸嬬偤宕归崜浣规殰闁圭儤鎸诲▍鐘绘煛鐏炶鍔滈柣?
 * 1. getCurrentPackage(cityId) 闂?闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲忛崕鎶藉焵椤掑﹦绉甸柛鐘崇墱婢规洟宕稿Δ浣哄幍闂佽鍨虫晶妤吽夋径鎰闁哄鍩婇煬顒勬煛鐏炶鈧繈骞婂┑瀣妞ゆ棁鍋愭晶顖氣攽閻愯尙鎽犵紒顔肩灱缁辩偞绻濋崶褑鎽曞┑鐐村灟閸ㄧ懓鏁俊鐐€栧濠氬储瑜旈敐鐐哄煛閸愵亞锛濇繛杈剧到閹碱偊顢撻幘鍓佺＝鐎广儱瀚粣鏃傗偓娈垮枛椤兘宕规ィ鍐ㄧ疀濞达絽鎲￠崐顖炴⒑绾懎浜归悶娑栧劦閸┾偓妞ゆ帊绀佹晶顖涚箾閼测晝甯涚紒缁樼箞閹粙妫冨☉妤冩崟闂備胶绮〃鍛村箠濡櫣鏆﹂柨鐔哄Т缁狀噣鏌﹀Ο渚Ъ闁硅姤娲栭埞鎴︽倷閺夋垹浠ч梺鎼炲妿閹虫捁鐏嬪┑顔姐仜閸嬫捇鏌熼鑲╃Ш鐎规洖鐖兼俊鎼佸Ψ瑜忛妶閿嬩繆閻愵亜鈧倝宕滃▎鎾村亱闁圭偓鍓氬鏍ㄧ箾瀹割喕绨荤紒鐘茬秺閺岋綁骞囬鐐电シ濡炪値鍓欓悧鎾诲箖濡ゅ啯鍠嗛柛鏇ㄥ墮椤︹晠姊洪崨濠冨暗闁哥姵鐗犳俊瀛樻媴閸撳弶鍍靛銈嗗灱婵倝鎮楁繝姘拺閻熸瑥瀚崝銈夋煕濡崵澧辨俊鍙夊姍瀹曞ジ寮撮悢鍙夊闂備礁鎲＄粙鎴︽晝閵夛箑绶為柛鏇ㄥ灡閻撴洘淇婇婊冨付濞存粓绠栭弻锝夊灳瀹曞洨顔囬梺瀹狀潐閸ㄥ爼鐛繝鍥ㄧ厱濠电姴鍠氬▓鏇㈡煙娓氬灝濮傞柟顔界矒閹稿﹥寰勫畝瀣耿闂傚倷鑳剁划顖炲礉閺囩倣鐔哥節閸ャ劌鈧潡鏌ら幁鎺戝姢缂佺娀绠栭弻娑㈠焺閸忕媭浜幃妯侯吋婢跺鍘?
 * 2. getMonthData(pkgId, month) 闂?闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箻閺屸剝寰勭€ｎ亝顔呭┑鐐叉▕娴滄粓鎮″☉銏＄厱婵犲ň鍋撻柣鎺炵畵瀵煡顢旈崼鐔蜂画濠电姴锕ら崯鎵不閾忣偂绻嗛柛娆忣槸婵秹鏌熼鐣屾噮闁哥姴锕よ灒閺夌偞婢橀ˉ姘舵⒒娴ｇ懓顕滅紒璇插€归〃銉╁箹娴ｇ鍤戝┑鐐村灟閸ㄦ椽宕愰崹顐ｅ弿婵妫楁晶缁樹繆椤栨浜鹃梻鍌欑閹碱偊寮甸鍕剮妞ゆ牜鍋戦埀顑跨窔瀵挳濮€閳哄倹娅岄梻浣侯焾閺堫剟鎳濇ィ鍐╁亗闁稿本绮庣壕钘壝归敐鍛儓濞存粓绠栭弻娑欐償閵忕姭鏋欏Δ鐘靛仦椤ㄥ懘鈥﹂妸鈺佸窛妞ゆ洖鎳忕紞妤呮⒒娴ｅ憡璐￠柛搴涘€濆濠氭晸閻樿尙锛涢梺鐟板⒔缁垶寮查弻銉ョ缂侇喖鍘滈崑鎾绘嚑椤掑倹鏅ㄦ繝纰夌磿閸嬫垿宕愰弽顬″搫螣閻撳骸鐏婇梺瑙勫礃椤曆囨嫅閻斿吋鐓ラ柣鏂挎惈瀛濆Δ鐘靛亼閸ㄨ櫣鎹㈠☉銏犲耿婵°倕鍟伴澶愭⒑鐠囪尙绠伴柣妤€妫滈悘鍐⒑缂佹﹫鑰挎繛浣冲嫮顩烽柨鏇炲€归悡鏇㈡煏婵炲灝鍔滈柛瀣ㄥ劦閺屾洟宕遍弴鐙€妲銈庡亝缁诲嫰骞戦崟顖氫紶闁告洦鍠掗崑鎾诲垂椤旇鏂€闂佺粯鍔曞鍫曀夐悙鐑樼厱闁宠桨鑳舵晶鏇㈠础闁秵鈷戞い鎺嗗亾缂佸鏁婚崺娑㈠箳閹炽劌缍婇弫鎰板川椤斿吋娈橀梻浣告憸閸犳捇宕戦妶澶婅摕婵炴垯鍨圭粻锝嗙節闂堟稓澧㈠Δ鏃堟煟鎼淬値娼愭繛鍙夛耿瀹曞綊宕滄担鐟板簥濠电娀娼ч鍛存倷婵犲嫭鍠愰煫鍥ㄧ☉娴肩姵淇婇妶鍛櫤闁抽攱鍨块弻鐔虹矙閹稿孩宕崇紓浣哄У閹歌崵鎹㈠☉銏″殤妞ゆ巻鍋撻柍璇茬墢閳ь剝顫夊ú姗€宕归崸妤冨祦婵せ鍋撻柟铏矒濡啫鈽夊▎鎴斿亾椤撱垺鈷掑ù锝呮啞閸熺偞绻涚拠褏鐣电€规洘绮岄埥澶娢熼柨瀣簴闂備線娼ч悧鍡椢涘☉姘К闁逞屽墮閳规垿鎮欓懠顒€顣洪梺璇茬箲缁诲牆顕ｉ幖浣瑰亜闁稿繗鍋愰崢闈涱渻閵堝棙鈷掗柛妯犲洤鐒垫い鎺嗗亾婵炵》绻濋獮鍐╁閹碱厽鏅梺閫炲苯澧寸€规洘妞介崺鈧い鎺嶉檷娴滄粓鏌熼崫鍕棞濞存粓绠栧濠氬炊瑜滃Ο鈧梺鍝勮閸斿矂鍩為幋锕€骞㈡繛鍡楃箚閹凤繝姊绘担瑙勫仩闁稿﹥娲熷畷顖烆敍閻愯尙鐤勯梺闈涱煭婵″洨寮ч埀顒勬⒑閹肩偛鍔楅柡鍛箞瀵娊顢曢敂瑙ｆ嫼闂佸憡绻傜€氼噣鎮炵捄銊х＜閺夊牄鍔嶇粈鍐磼閸屾稑娴柡浣稿€块幃娆擃敆閳ь剟鎮垫导瀛樷拺闁革富鍘剧敮娑㈡偨椤栨稑绗掗柡鍡忔櫇缁?
 * 3. draftSave(pkgId, data) 闂?upsert 闂傚倸鍊搁崐鎼佸磹閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞闁靛ě鍛獎闂備礁澹婇崑鍛村箚婵犲倵妲堥柕蹇曞Х椤︽澘顪冮妶鍡欏ⅳ闁稿鎹囬弻娑㈠Ψ椤旂厧顫梺缁樺笩閸嬫劙鍩€椤掆偓缁犲秹宕曢幍顔藉闁哄被鍎辩壕濠氭煙閸撗呭笡闁哄懏绻堥弻娑氫沪閹冩懙闂佸摜鍋涢悥鐓庮潖濞差亝顥堟繛鎴ｉ哺椤庡棝姊婚崒姘仼閻庢凹鍓熼崺? 闂傚倸鍊搁崐宄懊归崶顒夋晪鐟滃繘鍩€椤掍胶鈻撻柡鍛█閵嗕礁鈻庨幘鍐插敤濡炪倖鎸鹃崑鐔兼偘閵夈儮鏀芥い鏃€鏋绘笟娑㈡煕濡湱鐭欑€规洩缍€缁犳盯骞橀幇顓燁棃闁轰焦鍔欏畷銊╊敇閻斿壊鍚橀梻鍌欑窔閳ь剛鍋涢懟顖炲储閸濄儳纾奸柤鎼佹涧閸濇椽鏌ｅ☉鍗炴灓闁逞屽墾缂嶅棝宕板Δ鍛；闁规壆澧楅悡鏇㈡煙闁箑鐏犵紒鎲嬪缁辨帡顢欓妸銉ヮ仹缂佽妫濋弻锝夊箛閸忓摜鐩庨梺閫炲苯鍘甸柛濠冪箓閻ｇ兘濮€閵堝棗浠奸柣蹇曞仧閸嬫挸鈻撴导瀛樷拺缂備焦锚婵鏌℃担瑙勫€愰柟顖氱焸瀹曞崬螖婵犲嫬鏁搁梻浣稿悑閹倸顭囪閹便劑宕奸妷锔惧幗闂佽鍎抽悺銊х矆閸愵喗鐓欏〒姘仢婵″ジ鎽堕敐澶嬬厽闁圭偓濞婇妤€霉閻樻垚鎴犳崲濞戞埃鍋撳☉娆樼劷闁活厼顑囩槐鎺楊敊閼恒儱纾抽悗娈垮枛椤兘骞冮姀銏犳瀳閺夊牄鍔嶅▍鎾斥攽閻樼粯娑ч柛濠傤煼閳ワ箓宕煎┑鎰婵炲鍘ч悺銊╁磹閻㈠憡鍋℃繛鍡楃箰椤忣亞鐥悙顒佸€愰柡灞剧⊕閹棃濡堕崱娆忔锭缂傚倷绀侀崐鍦暜閿熺姴鏋侀柛鎰靛枛绾惧吋绻涢幋鐐嗘垿鎮块崨瀛樷拻濞撴埃鍋撴繛浣冲泚鍥敇閵忕姷锛熼梺鑲┾拡閸撴稓绮婚弮鍫濈婵烇綆鍓欐俊浠嬫煃闁垮绗掗棁澶愭煥濠靛棛澧涙い蹇曞█閹粙顢涘☉姘垱闂佸搫鐬奸崰鎾跺垝濞嗘挸绠伴幖鎼枟椤ワ絾淇婇悙顏勨偓鏍箰閹间礁围缂佸娉曢弳锕傛煕椤愶絾绀€闁绘挻绋戦埞鎴︽偐閹绘帗鏆?
 * 4. submitPreview(pkgId, data) 闂?闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犖ч柛銉㈡櫇閸橆垶姊绘担鍛婂暈婵炶绠撳畷銏ゆ寠婢跺本娈鹃梺鍛婄懃椤﹁京寮ч埀顒勬⒒閸屾氨澧涘〒姘殜瀹曟洟骞囬悧鍫㈠幈?+ 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇氱秴闁搞儺鍓﹂弫鍐煥閺囨浜鹃梺姹囧€楅崑鎾舵崲濠靛洨绡€闁稿本绮岄。娲⒑閽樺鏆熼柛鐘崇墵瀵寮撮悢铏诡啎闂佸壊鐓堥崰鏍ㄧ珶閸曨偀鏀介柣鎰级閳绘洖霉濠婂嫮鐭掔€规洘锕㈤崺鈧い鎺嗗亾妞ゎ亜鍟存俊鑸垫償閳ユ枼鎷婚梻浣告憸閸ｃ儵宕戞繝鍌滄殾闁诡垶鍋婂Σ楣冩⒑缁嬪尅鍔熼柛瀣ㄥ€曢～蹇撁洪鍜佹濠电偞鍨兼禍顒勫礉閹间焦鈷戦柟鑲╁仜婵偓濡炪値鍋勯ˇ杈╁垝?
 * 5. submitMonth(pkgId, data) 闂?闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犖ч柛銉㈡櫇閸橆垶姊绘担鍛婂暈婵炶绠撳畷銏ゆ寠婢跺本娈鹃梺鍛婄懃椤﹁京寮ч埀顒勬⒒閸屾氨澧涘〒姘殜瀹曟洟骞囬悧鍫㈠幈闁诲函缍嗛崐鏍箣閻樺啿搴婂┑鐐村灟閸ㄥ綊鐛姀鈥茬箚妞ゆ牗绻嶉崵娆撴⒒婢跺﹦效婵﹨娅ｇ槐鎺懳熼搹璇″剬缂傚倷绶￠崳顕€宕归崼鏇犲祦闁割偁鍎辨儫闂侀潧顦ù鐑藉窗閺嶎厼绠圭憸鐗堝笚閸庡矂鏌涘┑鍕姢妞わ富鍨崇槐?闂?闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋涢ˇ鐢稿极閹剧粯鍋愰柤纰卞墻濡茬兘姊绘担鍛婃儓缂佸绶氬畷銏＄鐎ｎ亞锛涢梺璺ㄥ枔婵敻鎮¤箛鎿冪唵閻犺櫣鍎らˉ鐐寸箾閸涱厽鍣界紒杈ㄥ浮閹晠宕归锝嗙槗闂備礁鎼懟顖滅矓閻熸壆鏆︽い鎰剁畱缁€瀣亜閹哄棗浜惧┑鐐叉噷閸婃繂顫?+ 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箻閺岀喖骞嗛弶鍟冩捇鏌涙繝鍌涘仴闁哄被鍔戝鏉懳旈埀顒佺閹屾富闁靛牆楠搁獮鏍煟韫囨梻绠氶柣蹇斿浮濮婃椽宕楅懖鈹垮仦闂佸搫鎳忕换鍫ｆ濡炪倖鐗滈崑鐐哄磹閸偒娈介柣鎰皺娴犮垽鏌涢弮鈧喊宥夊Φ閸曨垱鏅滈悹鍥皺娴狀垳绱撴笟鍥ф灈妞ゎ厾鍏橀獮濠囧冀椤撶偟鍘撮梺璇″瀻閸屾凹妫滃┑掳鍊楁慨鐑藉磻濞戙垺鍊舵繝闈涱儏缁€澶嬫叏濡灝鐓愰柛濠傜仛閹便劌螣閻撳骸浠橀梺鍝勵儍閸婃妲愰幒妤婃晩闁伙絽鏈崳顓犵磽娴ｈ櫣甯涚紒璇茬墕閻ｇ兘宕奸弴鐐嶁晝鎲稿澶屽祦闁规壆澧楅埛鎺懨归敐鍛暈闁哥喓鍋ら弻娑㈠棘閻愬弶鍣藉☉鎾崇Ч閺岀喐娼忛崜褏鏆犵紓浣插亾濠㈣泛顑嗛崣蹇斾繆椤栨哎浠掗柛姘煎亞閻?+ 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犵厱婵﹩鍘介妵婵嗏攽闄囬崺鏍ь嚗閸曨厸鍋撻敐搴濈胺婵″弶鍔欏缁樼瑹閳ь剙顭囪婢ф繈姊洪崫鍕櫤闁烩晩鍨堕獮蹇涘箣閿旇棄浜滈柣蹇撶箣閻掞箓寮埀顒勬⒒娴ｈ櫣甯涢柨姘扁偓娈垮枦閸╂牕顕ラ崟顖氱妞ゆ牗绋撻崢閬嶆煟鎼搭垳绉甸柛瀣閹便劌顓兼径瀣幐闁诲繒鍋犻褔鍩€椤掍胶绠撻柣锝囧厴椤㈡洟鏁冮埀顒€鏁俊鐐€栧Λ浣规叏閵堝鍎婃繝濠傜墛閳?
 */
@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(AnnualPackageEntity)
    private readonly packageRepo: Repository<AnnualPackageEntity>,
    @InjectRepository(ContractMonthRowEntity)
    private readonly contractRowRepo: Repository<ContractMonthRowEntity>,
    @InjectRepository(CostMonthRowEntity)
    private readonly costRowRepo: Repository<CostMonthRowEntity>,
    @InjectRepository(MaintenanceMonthRowEntity)
    private readonly maintenanceRowRepo: Repository<MaintenanceMonthRowEntity>,
    @InjectRepository(MonthSnapshotEntity)
    private readonly snapshotRepo: Repository<MonthSnapshotEntity>,
    @InjectRepository(MonthUnlockGrantEntity)
    private readonly unlockGrantRepo: Repository<MonthUnlockGrantEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepo: Repository<ContractEntity>,
    @InjectRepository(AllocationEntity)
    private readonly allocationRepo: Repository<AllocationEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(OperationLogEntity)
    private readonly operationLogRepo: Repository<OperationLogEntity>,
  ) {}

  // ============================================================
  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸ゅ嫰鏌涢锝嗙５闁逞屽墾缁犳挸鐣烽悡搴唵婵犻潧鐗婇崵鈧銈庡亝缁诲嫰骞戦崟顖涙優閻犲洠鍓濊倴婵犵數濮甸鏍窗濡ゅ懏鏅濋柍鍝勬噹缁€鍫ユ煏婵炵偓娅嗛柛銈傚亾闂備礁澹婇悡鍫ュ窗閹捐鐒垫い鎺嶇缁楁帗銇勯锝囩疄闁轰焦鍔欏畷銊╊敆閳ь剟藟濮樿埖鈷戦悹鍥ㄥ絻椤掋垺銇勯弮鈧悧鐘茬暦閹剁瓔鏁嬮柍褜鍓欓悾宄邦煥閸愶絾顫嶉梺闈涚箳婵兘鎮块崨瀛樷拺闁革富鍙€濡炬悂鏌涢悩宕囧⒈缂侇喖鐗忛埀顒婄秵閸嬩焦绂嶅鍫熺厵闁绘劦鍓氱紞鎴炪亜閵夛箑鍝洪柡?
  // ============================================================

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲忛崕鎶藉焵椤掑﹦绉甸柛鐘崇墱婢规洟宕稿Δ浣哄幍闂佽鍨虫晶妤吽夋径鎰闁哄鍩婇煬顒勬煛鐏炶鈧繈骞婂┑瀣妞ゆ棁鍋愭晶顖氣攽閻愯尙鎽犵紒顔肩灱缁辩偞绻濋崶褑鎽曞┑鐐村灟閸ㄧ懓鏁俊鐐€栧濠氬储瑜旈敐鐐哄煛閸涱喒鎷洪梺鍛婄箓鐎氼剟顢旈妷鈺傜厱閹艰揪绲鹃弳顒勬煟濞戝崬娅嶇€殿喕绮欐俊鎼佹晜閸擃灝銈夋⒒娴ｅ憡鍟為柟绋挎瀹曨亪宕橀鍕劒濠电姷顣槐鏇㈠磻閹达箑纾归柡鍥╁У瀹曟煡鏌熼柇锕€鏋涙い銉︾閵囧嫰骞橀崡鐐典患缂備胶濮烽崰鏍蓟閻斿吋鈷掗悗鐢殿焾婵′粙姊虹粙娆惧剰妞ゆ垵顦靛璇测槈閵忊晜鏅濋梺闈涚墕閹冲繘鎮楅懡銈囩＜闁绘劦鍓氱欢鑼磼婢跺本鏆╅柟骞垮灩閳规垹鈧綆浜為崢閬嶆⒑闁偛鑻晶瀵糕偓瑙勬磸閸旀垿銆佸Ο琛℃婵炲棙鍨熼崑鎾村鐎涙ǚ鎷绘繛杈剧秬濞咃絿鏁☉妯糕偓鎺戭潩椤撗勭杹閻庤娲樻繛濠囧极閹版澘妞藉ù锝呮啞椤撳潡姊绘担绋款棌闁稿鎳庣叅闁哄稁鍋嗘稉宥夋煥濠靛棙顥犵紒鈾€鍋撻梻浣稿閻撳牓宕戦崟顒佸弿闁搞儺鍓氶悡娑樏归敐澶樻闁活厽鐟﹂幈銊︾節閸曨厼绗￠梺鐟板槻閹虫ê鐣烽悜绛嬫晣闁绘棁顕ч崡鎶芥⒒閸屾瑧顦﹂柟璇х節瀵濡搁埡鍌氬壎婵犻潧鍊婚…鍫ユ倿閸偁浜滈柟鍝勭Ф椤︼箓鏌涢妶搴″⒋闁哄本鐩獮妯尖偓闈涙啞閸掓盯姊虹化鏇熸澒闁稿鎸搁—鍐Χ閸℃娼戦梺绋款儐閹瑰洭寮婚敐鍫㈢杸闁哄倸鐏濋幗鐢告⒑鏉炴壆顦﹂柛鐔风摠閹便劑鍩€椤掑嫭鐓忛柛顐ｇ箖閸ｆ椽鏌ｆ惔顔煎⒋闁诡喗顨婇悰顕€宕归鐓庮潛婵犵數鍋犻婊呭緤娴犲鐓濆ù鐘差儛閺佸倿鏌涢銈呮灁闁告ɑ鍎抽埞鎴︽倷鐎涙绋囧銈嗗灥濡鍩㈠澶婄倞妞ゆ帊鑳堕崢鐢告⒑閸︻厾甯涢悽顖滃仧缁柨煤椤忓懐鍘搁悗鍏夊亾閻庯綆鍓涜摫闂備浇顕栭崹鍗炍涢崘鈺傚弿闁逞屽墴閺屽秹宕瑰☉娆愮彅濡炪値鍋勯惌鍌氼潖缂佹ɑ濯撮柣鐔煎亰閸ゅ绱掗悙顒佺凡缂佸鐖奸獮鎴﹀閻橆偅鏂€闁诲函缍嗘禍鐐哄礉閿曗偓椤啴濡堕崱妤冪懆闁诲孩姘ㄩ崗妯侯嚕椤愶箑纾奸柣鎰嚟閸樺崬顪冮妶鍡楀Ё缂佽尪娉曠划璇参熷Ч鍥︾盎闂佹寧妫侀褎绂嶅鍫熺厓閻熸瑥瀚悘鎾煙椤旂晫鎳囩€规洩绲惧鍕熸导娆戠＜闂傚倷鐒﹂惇褰掑春閸曨垰鍨傞弶鍫氭櫆閺嗘粓鏌熼悜姗嗘當闁绘挻绻堥弻鐔兼倷椤掍胶绋囧銈嗘礋娴滃爼骞冨Δ鈧埥澶娾枎濡厧濮洪梻浣告啞閿曘垺绂嶇捄渚綎婵炲樊浜滄导鐘绘煕閺囥劌浜愰柛瀣尰缁傛帞鈧絽鐏氶弲顏堟偡濠婂啫顒㈢紒宀冮哺缁绘繈宕橀鍫燁€嶉梻浣告啞缁嬫垿鏁冮敃鍌氬偍闂侇剙绉甸埛鎴︽⒒閸喍绶遍柣鎺楃畺閺屾稒鎯旈妸銈嗗枤闂佺娅曠划搴ㄥ箟閹绢喖绀嬮柍琛″亾缂?
   */
  async getOrCreateCurrent(cityId: number, year: number): Promise<AnnualPackageEntity> {
    let pkg = await this.packageRepo.findOne({
      where: { cityId, reportYear: year },
    });

    if (!pkg) {
      pkg = this.packageRepo.create({
        cityId,
        reportYear: year,
        status: PackageStatus.DRAFT,
      });
      pkg = await this.packageRepo.save(pkg);
    }

    return pkg;
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲忛崕鎶藉焵椤掑﹦绉甸柛鐘崇墱婢规洟宕稿Δ浣哄幍闂佽鍨虫晶妤吽夋径鎰闁哄鍩婇煬顒勬煛鐏炶鈧繈骞婂┑瀣妞ゆ棁鍋愭晶顖氣攽閻愯尙鎽犵紒顔肩灱缁辩偞绻濋崶褑鎽曞┑鐐村灟閸ㄧ懓鏁俊鐐€栧濠氬储瑜旈敐鐐哄煛閸愵亞锛濇繛杈剧到閹碱偄鐨梻浣告啞椤ㄥ棙绻涙繝鍌ゅ殨閻犲洦绁村Σ鍫ユ煏韫囨洖顫嶉柕濞炬櫆閻撴瑩鎮楀☉娆樼劷缂佺姵鐗犻弻娑㈡晲閸パ冨闂侀€涚┒閸旀垿寮幇鏉垮窛闁哄鍨甸崣濠冪節濞堝灝鏋涢柨鏇樺劚椤啴鎸婃径灞炬闂侀潧顭俊鍥╁姬閳ь剟姊洪崨濠冨闁稿鍋撻梺鍛婅壘閸婂灝顫忕紒妯诲濞撴凹鍨遍弫顖氣攽閻愬弶鍣烘繛鑼枎閻ｅ嘲鈹戠€ｎ亜宓嗛梺闈涚箳婵兘宕㈠ú顏呪拺閻熸瑥瀚粈鍐┿亜閺囧棗鎳愭稉宥夋煥濠靛棭妲归柣鎾卞劦閺岋繝宕堕…鎴炵暥婵炲瓨绮撶粻鏍蓟閿濆鍋勯柛婵勫劜閸ゅ倻绱撴担鍝勑ｉ柟鐟版搐椤曪絿鎷犲ù瀣潔闂侀潧绻掓慨鏉戠暤閸℃稒鈷戦梻鍫熶緱閻掗箖鏌涙惔銊ゆ喚闁挎繄鍋ら、鏃堝幢濞嗘埊绱冲┑鐐舵彧缁蹭粙骞栭锝囧ⅰ闂傚倷鐒﹂幃鍫曞礉鐏炵瓔鐒介柍銉﹀墯閸ゆ洖鈹戦悩宕囶暡闁稿瀚伴弻褑绠涢幘纾嬬闂佹寧绋掔划宀勫煘閹达箑鐓￠柛鈩冾殘娴犫晠姊洪崷顓涙嫛闁稿锕弫鎰版倷閸濆嫰鍞跺┑鐘绘涧閸燁垶寮埀顒佷繆閻愵亜鈧牕顫忚ぐ鎺戝嚑濠电姵鑹剧粈鍌涖亜閹烘垵鈧崵澹曟總鍛婄厽婵☆垱瀵ч悵顏嗏偓瑙勬礀閺堫剟銆冮妷鈺傚€烽柟缁樺笚濞堝姊虹化鏇熸珨缂佺粯绻傞悾鐑藉Ω閳哄﹥鏅╅梺绋跨箺閸嬫劙寮堕搹鍦＝闁稿本鐟чˇ锕€顭胯婵倝寮茬捄浣曟棃宕ㄩ鑺ョ彣濠电姷鏁搁崑娑㈡偤閵娧冨灊鐎广儱顦壕鍧楁煙閹増顥夋潻婵嬫⒑閸︻厼鍔嬮柛鈺佺墕椤洭鍩￠崒妯圭盎闂佸湱鍎ら崺濠傤啅閵夈儮鏀芥い鏃傛櫕閵嗘帞绱掓潏銊﹀鞍闁瑰嘲鎳橀獮鎾诲箳瀹ュ拋妫滈梻鍌氬€风粈渚€骞夐垾瓒佹椽鏁冮崒姘€梻渚囧墮缁夌敻宕戦崒鐐寸厸闁搞儮鏅涢弸鎴︽煕濞嗗繒绠插ǎ鍥э躬椤㈡稑顭ㄩ崘銊ょ帛闂佹眹鍩勯崹闈涒枖濞戙垺绠掓繝鐢靛Т鑹岄柛瀣崌閺屾稑螖娴ｇ硶鏋欓悗娈垮枦椤曆囶敇婵傜閱囨い鎰剁秵閳ь剙娲缁樻媴閸涘﹤鏆堥梺鍦焾椤兘骞嗛崟顖ｆ晬婵椴稿▓楣冩⒑绾懏褰х紒鐘冲灩缁鎳￠妶鍥╋紲濠电偞鍨堕崙褰掑绩娴煎瓨鐓冪憸婊堝礈濞嗗浚鐒介柨鐔哄Т閽冪喖鏌曟繛鐐珕闁稿瀚伴弻娑樷攽閸℃褰呴梺闈涚箞閸婃牠鎮￠弴銏＄厵闁煎壊鍓欐俊鐓幟瑰鍫㈢暫婵﹤顭峰畷鎺戔枎閹存繂顬夐梻浣筋嚃閸犳牠鎮ラ悡搴ｆ殾闁哄洢鍨洪崐缁樹繆椤栨壕鎷℃繛鍙夋倐濮婃椽宕滈幓鎺嶇凹濠电偛寮堕悧鐘诲箠濠婂棎浜归柟鐑樻尵閸樺崬顪冮妶鍡楀Ё缂佹彃澧界划鍫ュ礃椤旂晫鍘?
   * 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇氱秴闁搞儺鍓﹂弫鍐煥閺囨浜鹃梺姹囧€楅崑鎾舵崲濠靛洨绡€闁稿本绮岄。娲⒑閽樺鏆熼柛鐘崇墵瀵寮撮悢铏诡啎闂佸壊鐓堥崰鏍ㄧ珶閸曨偀鏀介柣鎰级閳绘洖霉濠婂嫮鐭掔€规洘锕㈤崺鈧い鎺嗗亾妞ゎ亜鍟存俊鍫曞幢濡儤娈梻浣侯焾椤戝棝鎯勯姘辨殾妞ゆ帒瀚儫闂佸啿鎼崐鐢稿箯閾忓湱纾介柛灞剧懅閸斿秹鎷戦柆宥嗗€堕煫鍥风到楠炴绱掔紒妯兼创妤犵偞锕㈤、姘跺川椤曞懏顥涘┑鐘垫暩閸嬬偤宕硅ぐ鎺戞瀬濠电姵鑹鹃弰銉╂煃? [{monthNo: 1, submitted: true, overdue: false}, ...]
   */
  async getMonthStatuses(packageId: number): Promise<{monthNo: number; submitted: boolean; overdue: boolean}[]> {
    const snapshots = await this.snapshotRepo.find({
      where: { packageId },
      select: ['belongMonth'],
    });
    const submittedSet = new Set(snapshots.map((s) => s.belongMonth));
    const months: {monthNo: number; submitted: boolean; overdue: boolean}[] = [];
    for (let m = 1; m <= 12; m++) {
      const submitted = submittedSet.has(m);
      const overdue = !submitted && this.isMonthOverdue(m);
      months.push({ monthNo: m, submitted, overdue });
    }
    return months;
  }

  /**
   * 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕閵堝懎顏柡灞剧洴椤㈡洟鏁愰崱娆樻К缂傚倷鐒﹂崝鏍€冩繝鍥ц摕闁跨喓濮撮悙濠囨煏婢跺牆鍔ら柛鏃€鎸冲鐑樻姜閹殿噮妲┑鐐叉▕閸欏啫顕ｇ拠娴嬫婵☆垶鏀遍弬鈧梻浣告啞濞诧箓宕戦崟顒佸弿闁哄洢鍨洪悡鐔煎箹濞ｎ剙鐏い锝堝皺閳ь剙鍘滈崑鎾绘煙闂傚顦﹂柦鍐枛閺岋繝宕堕埡浣圭€荤紓浣稿閸嬨倝寮诲☉銏╂晝闁挎繂娲ㄩ悾鍨節濞堝灝鏋旈柛銊ㄦ椤繐煤椤忓嫬绐涙繝鐢靛仦绾板秹宕规担鍐罕闂備礁鎲￠崝锕傚窗閺嶎偆涓嶉柡宥庣亹瑜版帗鍋愮€瑰壊鍠栭崜楣冩⒑鏉炴壆顦︾紒澶屾暬楠炲牓濡搁妷顔藉缓闂佺硶鍓濋〃鍛寸嵁鐎ｎ喗鈷戠紒瀣儥閸庢劙鏌熼悷鐗堝枠妤犵偛鍟ˇ鐗堟償閵忊剝顔囨俊鐐€栭弻銊ц姳闁秴纾婚柟鎹愵嚙閸ㄥ倹銇勯弮鍥モ偓鈧柛瀣崌楠炴帡骞嬮鐔峰厞闂備焦瀵х换鍌炲箠瀹ュ棛鐝堕柡鍥ュ灪閻撶喖骞栧ǎ顒€鐒洪柛鐔风箻閺屾盯鏁愭惔鈩冪彎閻庤娲橀崹鍓佹崲濠靛纾兼繝濠傚椤旀洟姊绘担铏瑰笡闁圭鎽滈懞閬嶅醇閺囩偟鍝楁繛瀵稿Т椤戝棝鎮￠弴銏＄厪濠㈣泛顑呴悘宥夋煕鐎ｎ偅宕岄柡灞剧〒閳ь剨缍嗛崑鍛暦鐏炶В鏀介梽鍥春閺嵮屽殫闁告洦鍘搁崑鎾绘晲鎼粹€愁潻濡ょ姷鍋涢悧濠勬崲濠靛棌鏋旈柛顭戝枟閻忓秹姊洪幐搴㈢５闁哄懐濮撮悾宄邦煥閸愶絾鏂€闂佸壊鍋呴懝鐐閻愵剚鍙忔慨妤€妫楁禍婊呪偓瑙勬尭濡繈寮婚敍鍕勃闁告挆鍕灡濠电姷顣介崜婵嬪箖閸屾稐绻嗛柣鎴ｆ閻撴稑霉閿濆浂鐒剧€殿喚鍏樺濠氬磼濞嗘埈妲梺鍦拡閸嬪﹪骞婇悢纰辨晬闁绘劕鐡ㄥ▍鍥⒑闂堟稓澧曟い锔跨矙瀵偊宕惰閺€浠嬫煕鐏炲墽鐭ら柣鎺斿亾椤ㄣ儵鎮欓鍕痪婵烇絽娲ら敃顏堛€佸☉妯锋婵炲棗绉抽幋鐑芥⒒娴ｅ憡鎲搁柛鐔锋健瀹曟垿骞樼紒妯锋嫽闂佺鏈懝楣冨焵椤掑倸鍘撮柟顔惧仱閺佸倿鏌ㄩ姘缂備焦顨嗙粙鎴﹀箠閹扮増鍎楁繛鍡樻尰閻撴瑩寮堕崼銉х暫婵＄虎鍣ｉ弻娑氣偓锝庝憾閸庢棃鏌″畝鈧崰鏍蓟閸ヮ剚鏅濋柍褜鍓熷鎼佹偄鐞涒€充壕閻熸瑥瀚粈鍐煟閹垮嫮绡€鐎殿喛顕ч埥澶愬閻樼數鏉搁梻浣圭湽閸ㄨ棄顭囪閺侇噣濡烽埡鍌楁嫼缂傚倷鐒﹁摫閻忓浚浜弻娑欐償閿濆棙姣堥悗娈垮枛椤嘲顕ｉ幘顔碱潊闁绘顕ч弫瑙勭節閻㈤潧鈻堟繛浣冲洦鍋嬮柛鈩冪☉閻掑鏌＄仦璇插姕闁抽攱鍨块弻锝夋偄閻撳簼鍠婂┑鐐茬墢婵炩偓闁哄本绋撻埀顒婄秵娴滅兘鐓鍌楀亾濞堝灝鏋︽い鏇嗗洤鐓″鑸靛姇椤懘鏌ｅΟ娲诲晱闁哥偞妞藉缁樻媴閸涘﹥鍎撻梺绋匡工閹芥粓鎳為柆宥嗙劶鐎广儱鎳庨崵鎴︽⒑閸涘﹣绶遍柛妯绘倐瀵劍绂掔€ｎ偆鍘介梺褰掑亰閸撴瑧鐥閺屾盯鏁愰崨顖溞ㄥ┑顔硷龚濞咃綁寮鈧、娆撳礈椤喗绮撻幃?
   */
  async getCityContractCount(cityId: number): Promise<number> {
    const raw = await this.allocationRepo
      .createQueryBuilder('a')
      .innerJoin('contracts', 'c', 'c.id = a.contractId AND c.is_deleted = 0')
      .where('a.cityId = :cityId', { cityId })
      .select('COUNT(*)', 'count')
      .getRawOne<{ count: string }>();
    return raw ? Number(raw.count) : 0;
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲忛崕鎶藉焵椤掑﹦绉甸柛鐘崇墱婢规洟宕稿Δ浣哄幍闂佽鍨虫晶妤吽夋径鎰闁哄鍩婇煬顒勬煛鐏炶鈧繈骞婂┑瀣妞ゆ棁鍋愭晶顖氣攽閻愯尙鎽犵紒顔肩灱缁辩偞绻濋崶褑鎽曞┑鐐村灟閸ㄧ懓鏁俊鐐€栧濠氬储瑜旈敐鐐哄煛閸愵亞锛濇繛杈剧稻瑜板啯绂嶆ィ鍐┾拺缂佸娉曢悘閬嶆煕鐎ｎ剙浠遍柟顔欍倗鐤€闁圭虎鍨遍弬鈧梻浣虹帛閸旀浜稿▎鎰浄闁靛繈鍊栭悡鏇㈡煛閸愶絽浜鹃悗鍏夊亾闁归棿绀佺粻鏍ㄤ繆閵堝懏鍣洪柡鍛叀閺屾稓浠﹂崜褏鍙濇繝銏ｎ潐濞叉粎妲愰幘璇茬＜婵﹩鍏橀崑鎾诲箹娴ｅ摜锛欐俊鐐差儏鐎涒晠顢曢懞銉﹀弿婵☆垰娼￠崫娲煕韫囨梻鐭掗柡宀€鍠栧鑽も偓闈涘濡差噣姊洪幖鐐插闁稿﹤娼″濠氭晲婢跺娼婇梺缁樏Ο濠偽涘畝鍕拺閺夌偞澹嗛ˇ锔界箾鐏炲倸濡挎俊鍙夊姍楠炴帡寮崫鍕闂佹寧绻傜花鑲╄姳閸忚偐绠鹃柛娑卞幗瀹告繈鏌熼崣澶嬪€愮€殿噮鍓涢幑鍕Ω閿旂瓔鍟庨梻鍌欑婢瑰﹪宕戦崨顒兼椽寮介妸銉ュ闂傚倸鍊风欢姘焽瑜忛幑銏ゅ箳閹炬潙寮块梺鎯ф禋閸嬪棝鎮甸崼鏇熺厸闁搞儮鏅涢弸鏃傜磼閻樿崵鐣洪柡灞稿墲瀵板嫮鈧綆浜炴禒鎾⒑鐠団€虫灍闁搞劌娼″濠氭晲婢跺浜滃┑鐘绘涧濡瑩宕虫禒瀣厽妞ゆ挾鍋為ˉ銏ゆ煛鐏炲墽娲寸€殿喗鎸虫俊鎼佸Ψ閵忕姳澹曢柣搴秵閸樿绂嶈ぐ鎺撶厵闁绘垶蓱鐏忣厼霉濠婂啰绉烘慨濠冩そ瀹曘劍绻濋崟顒€娅戞俊鐐€х€靛矂宕规导鏉戠厺鐎广儱顦伴弲鎻掝熆鐠轰警鍎岄柟鐤缁辨捇宕掑▎鎴濆闁藉啴浜堕弻锝夊箻鐎靛憡鍒涢梺鍝勬湰缁嬫捇鍩€椤掑﹦绉甸柛瀣噽娴滄悂骞嶉鍓э紲缂傚倷鐒﹂…鍥Υ閹烘鐓冪憸婊堝礈濮樿京鐭欓柟鐑樸仜閳ь剨绠撳畷鍫曨敆娴ｇ澹掑┑鐘垫暩婵瓨瀵奸敐澶婄睄闁割偆鍠庢禍褰掓⒑閹勭闁稿瀚伴崺鈧い鎺嶇婵鏌嶈閸撴繈锝炴径濞掑搫顫滈埀顒勫箖閻戣棄鐓涢柛娑卞幗閻庮剟姊洪悷鏉库挃缂侇噮鍨跺畷鎴﹀箛閻楀牏鍘剧紒鐐緲瀹曨剚鏅舵繝姘厱闁绘劖澹嗛惌娆愭叏婵犲嫮甯涢柟宄版嚇瀹曨偊濡烽‖顔哄姂濮婅櫣绮欏▎鎯у壈闂佹寧娲忛崕宕囧垝鐎ｎ亶鍚嬮柛娑变簼閺傗偓闂佽鍑界紞鍡樼閿濆鏄ラ柣鎰嚟缁♀偓闂侀潧楠忕徊浠嬫偂閹扮増鐓曢柡鍐ｅ亾闁绘濞€楠?month_snapshots闂?
   *
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏℃櫇闁逞屽墴閹虫粏銇愰幒鎾跺幐闁诲繒鍋犻褔宕濆杈╃＜闁逞屽墴瀹曟﹢顢欓悾灞藉笚闂佸搫顦遍崑鐐寸珶閸℃稑绀夌€广儱娲ㄧ壕鍏间繆閵堝倸浜鹃梻浣稿簻缁蹭粙锝炶箛鏇犵＜婵☆垵顕ч鎾绘⒑閹呯闁硅櫕鎸剧划顓㈡晸閻樻枼鎷洪梺闈╁瘜閸欏酣鎮為悙顑跨箚妞ゆ劧绲跨粻鎾绘煟閿濆懎妲绘い顐ｇ矒閸┾偓妞ゆ帊妞掔换鍡涙煙闂傚鍔嶉柡鍛箞閺屽秷顧侀柛鎾跺枛瀹曟椽鍩€椤掍降浜滈柟鐑樺焾濡叉悂鏌ｈ箛銉х暤闁哄备鈧磭鏆嗛悗锝庡墰钃遍梻浣筋嚃閸ㄥ崬螞閸愵喖鏋侀柟鐗堟緲楠炪垺淇婇妶鍕厡闁哄棙鑹鹃埞鎴︽偐閸偅姣勬繝娈垮櫘閸欏啫鐣烽幋锕€绠荤紓浣骨氶幏鍝勵渻閵堝棗鍧婇柛瀣尵缁辨帗寰勭仦鐐瘓閻庤娲橀崹鎸庝繆閼搁潧绶為悗锝庡墮鐢儳鈹戦悩顔肩伇婵炲绋戣灋婵炲棗绻嗛弸宥夋煕閳╁啰鈯曢柣鎾存礋閹鏁嶉崡鐐差仾闁绘繃宀稿娲传閸曨剚鎷卞┑鐐插级閿氭い鏇樺劦瀹曠喖顢曠€ｎ剙鏋涢柟鐓庣秺閺屽懎鈽夊Ο渚殭缂?
   * - 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏℃櫇闁逞屽墴閹虫粏銇愰幒鎾跺幐闁诲繒鍋犻褔宕濆杈╃＜闁逞屽墴瀹曟﹢顢欓悾灞藉笚闂佸搫顦遍崑鐐寸珶閸℃稑绀夌€广儱娲ㄧ壕鍏间繆閵堝倸浜鹃梻浣稿簻缁蹭粙锝炶箛鏇犵＜婵☆垵顕ч鎾绘⒑閹呯闁硅櫕鎸剧划顓㈡晸閻樻枼鎷洪梺闈╁瘜閸欏酣鎮為悙顑跨箚妞ゆ劧绲跨粻鎾绘煟閿濆懎妲绘い顐ｇ矒閸┾偓妞ゆ帊妞掔换鍡涙煙闂傜顔夐柍褜鍓ㄧ粻鎾荤嵁鐎ｎ亖鏀介柛銉ｅ妽閻︽棃姊婚崒姘偓鎼佸磹閹间礁纾归柣鎴ｅГ閸ゅ嫰鏌涢锝嗙闁稿被鍔庨幉鎼佸籍閸繄鐣洪梺绉嗗嫷娈旈柣鎰躬閺屾洘绻濊箛鏇犳殸閻庢鍠栧鈥愁潖濞差亝顥堟繛鎴炶壘椤ｅ搫顪冮妶蹇曠窗闁告鍟块悾鐑藉即閻旈绐為梺褰掑亰閸橀箖宕㈤崡鐐╂斀闁绘劖娼欓悘锕傛煟閻曞倸顩紒杈╁仱楠炲鏁傞挊澶嗗亾?orderGrossProfit / netProfit 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛濠傛健閺屻劑寮崹顔规寖闂佹椿鍘介悷鈺呭蓟閻斿皝鏋庨梽鍥敋瑜嶇叅闁挎棃鏁崑鎾绘濞戞牕浠悗娈垮枛閻栧ジ鐛€ｎ喗鏅查柛鈩兠弳顐⑩攽閻樺灚鏆╁┑顔惧厴瀵偊宕ㄦ繝鍐ㄥ伎闁诲海鏁哥涵鍫曞磻閹炬剚娼╅柍褜鍓熷畷鎯邦槾闁挎稒鐩娲捶椤撶偘澹曢梺鍝勵儑閸樠冨祫闂佸壊鍋嗛崰鎾剁不妤ｅ啯鐓曢柍鈺佸暔閳ь剛鍋ら獮瀣晜閽樺鎮ｉ柣搴ｆ嚀鐎氫即宕戞繝鍌樷偓?
   * - 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亜顒㈡い鎰矙閺屻劑鎮㈤崫鍕戙垻绱掗埀顒勫醇閻旇櫣顔曢梺绯曞墲椤ㄥ牏鎷归埡鍌滅鐎瑰壊鍠曠花濠氬炊鐎涙绡€闁靛骏绲剧涵楣冩煥閺囨ê鍔氶崡杈ㄣ亜閹烘垵顏柛濠勬暬閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勫窛濠电姴鍟ˇ鈺呮⒑缁嬫鍎忔俊顐ｇ箞楠炲棝宕奸妷銉ь槹濡炪倖鐗楃粙鎴炵椤撶偐鏀介柣妯款嚋瀹搞儵鏌涢悢鍝勵暭闁哄懌鍎叉穱濠囧Χ閸ヮ灝銉╂煕鐎ｎ剙浠辨鐐村灴瀹曞爼顢楅埀顒勫及閵夆晜鐓ラ柣鏂挎惈瀛濋悗鐟版啞缁诲啴濡甸崟顖氱睄闁割偆鍣︾槐鐢电磽娴ｉ潧濡块柡浣割煼瀵鏁愭径瀣簻闂佸憡绺块崕鎶芥偂閳ь剙鈹戞幊閸婃鎱ㄩ悽绋跨畺闁稿瞼鍋涢悘鎶芥煛閸愩劎澧曠紒鈧崘鈹夸簻闁哄啫娲ゆ禍褰掓煥濞戞瑧鐭掓慨濠呮缁辨帒螣閸濆嫷娼撴俊鐐€栧ú锕傚矗閸愩劎鏆︽繝闈涱儐椤ュ牊绻涢幋鐐茬瑲闁哄倵鍋撳┑锛勫亼閸婃牕顫忔繝姘亗妞ゆ劧瀵岄弫鍌炴煕閳╁喚娈㈡俊顐ｇ矊椤啴濡堕崱妯烘殫婵犳鍣ｉ弨杈╃矙?contractRowsJson + allocation.rate 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴鐐测偓鍝ョ不閺嶎厽鐓曟い鎰剁稻缁€鈧紒鐐劤濞硷繝寮婚悢鐓庣畾闁绘鐗滃Λ鍕磼閻愵剙鍔ゆい顓犲厴瀵鏁愭径濠冾棟闂佸壊鐓堥崰妤呭磹椤栫偞鈷?
   * - 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磽娴ｅ搫鞋妞ゎ偄顦垫俊鐢稿礋椤栨氨鐤€闂佸憡鎸烽懗鍫曞汲閻樺厖绻?allocation 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏℃櫇闁逞屽墴閹潡顢氶埀顒勫蓟閻旂厧绠氶柣妤€鐗滃Λ鍕⒑閸濆嫬顏ラ柛搴ｆ暬瀵鍨鹃幇浣告倯闁硅偐琛ラ埀顒冨皺閻栭亶姊?0 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繐霉閸忓吋缍戦柛銊ュ€块弻锝夊箻瀹曞洤鍝洪梺鍝勵儐閻楁鎹㈠☉銏犵闁绘劘灏欓崝浼存⒑缁嬫鍎愰柟鍛婃倐閿濈偛鈹戠€ｎ偄浜楅柟鍏肩暘閸ㄦ槒銇愭惔顫箚闁靛牆娲ゅ暩闂佺顑嗛惄顖氱暦椤栫儐鏁嶆繝濠傚鎼村﹤鈹戦悩缁樻锭妞ゆ垵鎳橀幃娆愮節閸ャ劎鍘繝鐢靛Т缁绘ê顬婇鈧弻锝呪攽閹邦兛鍠婂┑顔硷功缁垶骞忛崨顖滅煓婵炲棛鍋撻ˉ鎴︽⒒娴ｄ警鐒炬い鎴濇嚇楠炲﹪骞囬弶璺槴闂佸湱鍎ら幐濠氬磿閻斿吋鐓忓┑鐘茬箳閻ｅ崬霉閻欌偓閸樺ジ鍩為幋锔藉亹缂備焦蓱闁款厼顪冮妶鍡楃仴婵☆偅绻堥獮鍐灳閺傘儲鐎婚梺瑙勫劤椤曨參宕㈡ィ鍐┾拺闁告稑锕︾紓姘舵煕鎼淬垻鍙€鐎殿喗濞婇崺锟犲磼濠婂拋鍟庨梻浣告啞閻熴儵藝閹殿喕鐒婇柨鏇炲€归悡娑㈡倶閻愭鐒惧褎鐓￠弻鐔风暋閻楀牆娈楀┑鈽嗗亜閸熸挳宕洪敓鐘茬妞ゆ劧绲介崜鐢告⒒閸屾艾鈧嘲霉閸パ屾禆闁靛ě鍛劶婵炶揪缍€濞咃綁鎯岄幘缁樼厵缂備降鍨归弸鐔兼煕鐎Ｑ勬珕缂佺粯绻堝Λ鍐ㄢ槈閸楃偛澹堥梻浣虹帛鐢帡鎮樺璺何﹂柛鏇ㄥ灠缁犳娊鏌熺€涙绠ュù鐘层偢濮婅櫣鎷犻懠顒傤啈濠电偛鎳忓ú妯肩矚鏉堛劎绡€闁搞儴鍩栭弲顒€鈹戦悩缁樻锭婵☆偅顨婇獮鍡涙倷閻戞ǚ鎷洪悗瑙勬礀濞诧箓宕甸埀顒傜磽娴ｅ壊妲洪柡浣规倐楠炴垿濮€閻橆偅鏂€闁诲函缍嗛崑鎺懳涢崘銊㈡斀闁绘劖娼欓悘銉р偓瑙勬处閸撶喎鐣峰鍫濈畾鐟滃寮ㄦ禒瀣厽闁归偊鍨伴惃娲煙閻ｅ苯校缂佺粯鐩畷锝嗗緞鐏炶В鎷伴梻浣哄仺閸庢彃螞閸愩劎鏆︽慨妞诲亾妞ゃ垺鐟╁畷鍙夌珶椤栨碍澶勯柣鎾存礃缁绘盯骞嬪┑鍡氬煘濡ょ姷鍋為〃濠囧蓟濞戞瑧绡€闁稿本绋掑畷宕囩磽娴ｄ粙鍝洪柟绋款煼楠炲繘宕ㄩ娑樼彴闂佹枼鏅涢崯浼村汲閵夛缚绻嗛柣鎰典簻閳ь儸鍛亾闂堟稓鐒哥€规洖缍婂畷濂稿即閻愮數鏆┑掳鍊х徊浠嬪疮椤栫偛纾瑰┑鐘崇閻撱垺淇婇娆掝劅婵″弶妞介弻娑樜熺紒妯衡偓鎰叏婵犲懏顏犵紒顔界懇楠炴劖鎯旈姀鈥愁伆缂傚倸鍊风欢锟犲窗閺嶎煈娈芥慨婵嗙焾閺嗕即姊绘担鐟邦嚋婵炲弶鐗犲畷鎰亹閹烘垹鍘?
   * - grossProfit 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣銏犲閺佸﹪鏌″搴″箹缂佹劖顨嗘穱濠囧Χ閸涱収浠鹃梺鐟板暱閻倸顫忕紒妯诲闁告繂瀚慨锕傛⒑閸涘﹥灏扮紒璇插€婚崣鍛攽閻樿宸ラ柣妤€妫涚划濠氬蓟閵夛妇鍘棅顐㈡处濞叉牞鈪撮梻浣告惈椤戝懘鏌婇敐澶婅摕闁绘棁銆€閸嬫捇鎮藉▓璺ㄥ姼闂佸疇顕ч悧鎾诲蓟瀹ュ鍋￠柟娈垮枤椤斿绱撴担铏瑰笡缂佽鐗婇幈銊╁焵椤掑嫭鐓ユ繝闈涙椤ョ娀鏌曢崱妯哄妞ゎ亜鍟存俊鎯扮疀閺囩姵娈煎┑鐐茬摠缁矂鎮ユ總鍝ュ祦?orderGrossProfit闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弮鍫熸殰闁稿鎸剧划顓炩槈濡娅ч梺娲诲幗閻熲晠寮婚悢琛″亾閻㈡鐒惧ù鐘欏洦鈷掗柛鏇ㄥ亜椤忣參鏌″畝瀣瘈鐎规洘锕㈡俊鎼佸Ψ閵忕姳澹曢梺鐓庮潟閸婃绋夊澶嬬厸闁稿本渚楅崕銉╂煟閺傛寧顥㈤柡灞诲€濋獮鏍ㄦ媴鐟欏嫰鏁┑鐘愁問閸犳牠鎮ч幘璇茶摕婵炴垶鍩冮崑鎾绘晲鎼粹€茬盎闂佽楠忕粻鎾诲蓟閺囥垹鐐婄憸宥夘敂椤撶噥娈介柣鎰綑濞搭喗顨ラ悙宸剰闁宠鍨垮畷姗€濡搁妶鍜佹闂傚倷绀侀幖顐も偓姘煎墰閹广垽宕奸悢渚锤闂侀潻瀵岄崢鎼佸磻閹捐绀傚璺猴梗婢规洟姊绘笟鈧埀顒傚仜閼活垱鏅堕悧鍫滅箚闁告瑥顦慨宥嗩殽閻愭潙娴鐐寸懇瀹曟﹢鍩￠崘顏佹瀼闂傚倸鍊风粈渚€骞栭銈嗗珰闁绘劕鎼婵囥亜閹哄棗浜鹃梺纭呮椤戝棛鎹?
   */
  async getYearSummary(packageId: number): Promise<{
    completionTotal: number;
    acceptanceTotal: number;
    invoiceTotal: number;
    orderTotal: number;
    costTotal: number;
    orderGrossProfit: number;
    grossProfit: number;
    costRate: number;
    costIncomeRate: number;
    netProfit: number;
    netProfitRate: number;
    costCategoryTotals: Record<string, number>;
  }> {
    const pkg = await this.findPackageOrThrow(packageId);
    const [snapshots, activeUnlockGrants, realtimeContractRows, realtimeCostRows] = await Promise.all([
      this.snapshotRepo.find({ where: { packageId } }),
      this.unlockGrantRepo.find({ where: { packageId, expiresAt: MoreThan(new Date()) } }),
      this.contractRowRepo.find({ where: { packageId } }),
      this.costRowRepo.find({ where: { packageId } }),
    ]);
    const snapshotByMonth = new Map(snapshots.map((snapshot) => [Number(snapshot.belongMonth), snapshot]));
    const unlockedMonths = new Set(activeUnlockGrants.map((grant) => Number(grant.monthNo)));

    const selectedMonths = Array.from({ length: 12 }, (_, index) => index + 1).map((monthNo) => {
      const snapshot = snapshotByMonth.get(monthNo);
      if (snapshot && !unlockedMonths.has(monthNo)) {
        const contractRows = Array.isArray(snapshot.contractRowsJson)
          ? snapshot.contractRowsJson.filter((row: unknown): row is SnapshotContractRowLike =>
              this.isSnapshotContractRowLike(row),
            )
          : [];
        const costRows = Array.isArray(snapshot.costRowsJson)
          ? snapshot.costRowsJson.filter((row: unknown): row is SnapshotCostRowLike =>
              this.isSnapshotCostRowLike(row),
            )
          : [];
        const summary = typeof snapshot.summaryJson === 'object' && snapshot.summaryJson !== null
          ? snapshot.summaryJson as Record<string, unknown>
          : null;
        return { contractRows, costRows, summary };
      }
      return {
        contractRows: realtimeContractRows.filter((row) => Number(row.monthNo) === monthNo),
        costRows: realtimeCostRows.filter((row) => Number(row.monthNo) === monthNo),
        summary: null,
      };
    });

    const contractIds = [...new Set(
      selectedMonths
        .flatMap((month) => month.contractRows)
        .map((row) => Number(row.contractId))
        .filter((contractId) => Number.isFinite(contractId) && contractId > 0),
    )];
    const allocations = contractIds.length > 0
      ? await this.allocationRepo.find({
          where: { cityId: pkg.cityId, contractId: In(contractIds) },
        })
      : [];
    const allocationRateByContractId = new Map(
      allocations.map((allocation) => [Number(allocation.contractId), this.toFiniteNumber(allocation.rate)]),
    );

    let completionTotal = 0;
    let acceptanceTotal = 0;
    let invoiceTotal = 0;
    let orderTotal = 0;
    let costTotal = 0;
    let orderGrossProfit = 0;
    const costCategoryTotals: Record<string, number> = Object.fromEntries(
      VALID_COST_CATEGORY_CODES.map((code) => [code, 0]),
    );

    for (const month of selectedMonths) {
      let calculatedOrderGrossProfit = 0;
      for (const row of month.contractRows) {
        const completionAmount = this.toFiniteNumber(row.completionAmount);
        completionTotal += completionAmount;
        acceptanceTotal += this.toFiniteNumber(row.acceptanceAmount);
        invoiceTotal += this.toFiniteNumber(row.invoiceAmount);
        orderTotal += this.toFiniteNumber(row.orderAmount);
        calculatedOrderGrossProfit += completionAmount * (allocationRateByContractId.get(Number(row.contractId)) ?? 0);
      }
      for (const row of month.costRows) {
        const amount = this.toFiniteNumber(row.amount);
        const categoryCode = String(row.costCategoryCode ?? '').trim();
        costTotal += amount;
        if (categoryCode) {
          costCategoryTotals[categoryCode] = (costCategoryTotals[categoryCode] ?? 0) + amount;
        }
      }

      const snapshotOrderGrossProfit = month.summary?.orderGrossProfit;
      orderGrossProfit += snapshotOrderGrossProfit !== undefined
        && snapshotOrderGrossProfit !== null
        && Number.isFinite(Number(snapshotOrderGrossProfit))
        ? Number(snapshotOrderGrossProfit)
        : calculatedOrderGrossProfit;
    }

    const profitMetrics = calculateProfitMetrics(completionTotal, costTotal, orderGrossProfit);
    return {
      completionTotal,
      acceptanceTotal,
      invoiceTotal,
      orderTotal,
      costTotal,
      orderGrossProfit,
      grossProfit: orderGrossProfit,
      costRate: profitMetrics.costRate,
      costIncomeRate: profitMetrics.costIncomeRate,
      netProfit: profitMetrics.netProfit,
      netProfitRate: profitMetrics.netProfitRate,
      costCategoryTotals,
    };
  }

  private async getLegacyYearSummary(packageId: number): Promise<{
    completionTotal: number;
    acceptanceTotal: number;
    costTotal: number;
    orderGrossProfit: number;
    grossProfit: number;
    costRate: number;
    costIncomeRate: number;
    netProfit: number;
    netProfitRate: number;
  }> {
    const pkg = await this.findPackageOrThrow(packageId);

    const snapshots = await this.snapshotRepo.find({
      where: { packageId },
      select: ['cityId', 'summaryJson', 'contractRowsJson'],
    });

    let completionTotal = 0;
    let acceptanceTotal = 0;
    let costTotal = 0;
    let orderGrossProfit = 0;

    for (const s of snapshots) {
      const summary = s.summaryJson as Record<string, unknown> | null;
      if (!summary) continue;

      completionTotal += this.toFiniteNumber(summary.completionTotal);
      acceptanceTotal += this.toFiniteNumber(summary.acceptanceTotal);
      costTotal += this.toFiniteNumber(summary.costTotal);

      const recalculatedOrderGrossProfit =
        await this.calculateSnapshotOrderGrossProfitFallback(pkg, s.contractRowsJson);
      const hasContractRows = Array.isArray(s.contractRowsJson) && s.contractRowsJson.length > 0;
      orderGrossProfit += hasContractRows
        ? recalculatedOrderGrossProfit
        : this.toFiniteNumber(summary.orderGrossProfit);
    }

    const grossProfit = orderGrossProfit; // 闂傚倸鍊搁崐宄懊归崶顒夋晪鐟滃繘鍩€椤掍胶鈻撻柡鍛█閵嗕礁鈻庨幘鍐插敤濡炪倖鎸鹃崑鐔兼偘閵夆晜鈷戦柛婵嗗閳诲鏌涘Ο鍨汗缂侇喛宕甸幉鎾礋閳衡偓缁ㄥ姊虹憴鍕凡濠⒀冮叄閹箖鏌嗗鍡欏幐闂佸憡娲嶉弲娑㈠礉濠婂叇搴ㄥ炊瑜濋煬顒€鈹戦垾宕囧煟鐎规洏鍔戦、姗€鎮㈤崜鎻掓櫃濠电姷顣槐鏇㈠磻閻旂厧绠犻柟鎹愵嚙閻ゎ噣鏌涜閵囨盯鍩€椤掑﹤顩柟鐟板婵℃悂鏁冮埀顒傚椤栨稓绠鹃柟鐐綑閸ゎ剟鏌涢妸銊╁摵妞ゃ劍鐟╁?orderGrossProfit

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸ゅ嫰鏌涢锝嗙５闁逞屽墾缁犳挸鐣锋總绋款潊闁炽儱鍟跨花銉╂⒒娴ｇ顥忛柛瀣╃窔瀹曟洘娼忛埡鍐劶婵犮垼娉涙径鍥磻閹捐绀傚璺猴梗婢规洟姊绘担鍛婂暈婵炶绠撳畷鎴﹀幢濞存澘娲幃褔宕煎鍛暰闂備線娼ч悧鍡欐崲閹烘绀嗗ù鐓庣摠閻撴洟鏌ｉ弴姘鳖槮闁诲骏濡囬埀顒冾潐濞叉ê煤閺嶎収鏁囬柛蹇曞帶缁剁偤鎮楅敐搴″妤犵偛鐗撳缁樻媴閸涘﹥鍎撳┑鐐茬湴閸ㄨ棄鐣峰┑鍫滄勃闁绘劦鍓氶悵鐑芥⒑缂佹﹩娈旈柣妤€鎳愰幑銏ゅ幢濞戞瑧鍘电紓鍌欑劍閿氱紒妤佸笚娣囧﹪骞撻幒婵堝悑闂佸搫鏈ú鐔风暦閸楃倣鐔兼惞閸︻厽鍣┑锛勫亼閸娿倝宕戦崨顖涘床闁割偁鍎埀顑跨铻栧ù锝呮憸缁愮偞绻濋悽闈浶㈤柛濠冩倐钘熺€广儱顦伴埛鎺楁煕鐏炲墽鎳嗛柛蹇撶灱缁辨帡顢氶崨顓犱桓閻庢鍠栭…鐑藉极閹剧粯鍋愰柤纰卞墾缁遍亶姊绘担绛嬫綈闁稿孩濞婇、姘额敇閻樺吀绗夋俊銈忕到閸燁垶宕愰崹顐ょ闁瑰鍋熼幊鎰版煟閹哄秶鐭欓柡宀嬬秮椤㈡﹢鎮滈崶褌绱ｉ梺鍓х帛閻楃娀寮婚敐鍛傜喖骞愭惔锝呮锭闂備胶顭堥敃銉╁礉濡ゅ懎鐒垫い鎺戝枤濞兼劖绻涘ù瀣珖缂佽京鍋ら崺鈧い鎺戝€荤壕濂告煟濡櫣锛嶉柍钘夘樀閺屽秹鎸婃径妯恍﹀銈庡亝缁诲牓銆佸Δ鍛＜婵☆垵妗ㄩ崰濠囨⒒閸屾艾鈧嘲霉閸ヮ剦鏁嬬憸鏃堝蓟婵犲洦鏅查柛婊€鑳堕崝鐑芥偡濠婂嫭顥堥柣娑卞枛铻栭柍褜鍓熼垾锕傚Ω閳轰線鍞跺┑鐘绘涧閿曘儵骞夋导瀛樷拻濞达絿顭堥ˉ蹇涙煕鐎ｂ晝绐旂€规洘娲熷濠氬Ψ閵壯嶇幢闂備焦瀵х换鍌炲箖閼愁垬浜归柟鐑樻尰濞呮粓姊虹化鏇炲⒉闁荤噦缍佸畷鎴︽倷閻戞ǚ鎷虹紓浣割儐椤戞瑩宕曢幇鐗堢厵闁荤喓澧楅幖鎰亜閺囶亞绉い銏☆殜瀹曠喖顢曠€ｃ劌濮傞柡灞炬礃瀵板嫰宕煎┑鍐ㄤ壕闁哄洠鎳炴径濠庢僵妞ゆ垼濮ら弬鈧梻浣虹帛椤洨鍒掗姘ｆ鐟滄棃寮诲☉娆戠瘈闁稿被鍊楅崥瀣⒑閻愯棄鍔电紒鐘虫尭閻ｇ兘鎮℃惔妯绘杸闂佸憡鍔忛弲婵嬪焵椤掍焦銇濇慨濠冩そ濡啫鈽夊杈╂澖闂備胶顭堥敃銉╂偋閻樿绠栭柍銉︽灱濡插牓鏌曡箛銉х？闁告﹢浜堕弻锝堢疀閺囩偘绮舵繝鈷€鍌滅煓闁糕斂鍎插鍕偓锝冨妺缁ㄥ鏌熼崗鑲╂殬闁搞劌顭烽幆宀€鈧綆鍠楅悡蹇涙煕閵夋垵鍠氭导鍐ㄎ旈悩闈涗沪闁挎洏鍨介獮鏍亹閹烘繃鏅濋梺鎸庣箓閹冲繘鎮楅崜褏纾?
    const costRate = completionTotal !== 0 ? costTotal / completionTotal : 0;
    const costIncomeRate = orderGrossProfit !== 0 ? costTotal / orderGrossProfit : 0;
    const netProfit = orderGrossProfit - costTotal;
    const netProfitRate = completionTotal !== 0 ? netProfit / completionTotal : 0;

    const safe = (v: number) => (Number.isFinite(v) ? v : 0);

    return {
      completionTotal,
      acceptanceTotal,
      costTotal,
      orderGrossProfit,
      grossProfit,
      costRate: safe(costRate),
      costIncomeRate: safe(costIncomeRate),
      netProfit,
      netProfitRate: safe(netProfitRate),
    };
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲忛崕鎶藉焵椤掑﹦绉甸柛鐘崇墱婢规洟宕稿Δ浣哄幍闂佽鍨虫晶妤吽夋径鎰闁哄鍩婇煬顒勬煛鐏炶鈧繈骞婂┑瀣妞ゆ棁鍋愭晶顖氣攽閻愯尙鎽犵紒顔肩灱缁辩偞绻濋崶褑鎽曞┑鐐村灟閸ㄧ懓鏁俊鐐€栧濠氬储瑜旈敐鐐哄煛閸愵亞锛濇繛杈剧到閹碱偄鐨梻浣告啞椤ㄥ棙绻涙繝鍌ゅ殨閻犲洦绁村Σ鍫ユ煏韫囨洖顫嶉柕濞炬櫆閻撴瑩鎮楀☉娆樼劷缂佺姵鐗犻弻娑㈡晲閸パ冨闂侀€涚┒閸旀垿寮幇鏉垮窛闁哄鍨甸崣濠冪節濞堝灝鏋涢柨鏇樺劚椤啴鎸婃径灞炬濡炪倖鍔х粻鎴犵矆鐎ｎ偁浜滈柟鎹愭硾閸撻亶鏌￠崱鈺佷喊婵﹦绮幏鍛存惞閻熸壆顐兼俊鐐€戦崝宀勫箠鎼淬倗浜辨繝鐢靛仦閸垶宕硅ぐ鎺撳€块柛顭戝亖娴滄粓鏌熼悜妯虹仴闁哄鍊栫换娑㈠礂閻撳骸顫岄梺瀹狀潐閸ㄥ潡骞冨▎鎴炲珰鐟滄垿宕ラ鈶芥棃鎮╅棃娑楃捕濠碘槅鍋呯换鍌炴偩瀹勯偊娼ㄩ柍褜鍓熼妴浣糕枎閹炬潙娈愰梺鍐叉惈閿曘儲鏅ュ┑鐘殿暜缁辨洟宕戦幋锕€纾归柡宥庡幖缁€澶愭煥閺囩偛鈧摜绮堥崼鐔虹闁瑰鍋為惃鎴︽煟椤撶喓鎳囬柣鎿冨亰瀹曞爼濡歌婵洭姊洪幎鑺ユ暠闁搞劌缍婇幆鈧い蹇撶墱閺佸洭鏌ｉ幇顓熺稇婵炲憞鍥ㄢ拺闁告挻褰冩禍钘壝瑰搴濋偗鐎殿喛顕ч埥澶娾枎閹邦剙濡抽梻渚€娼х换鍫ュ垂閻熼偊鍤曢柕濞炬櫆閸婂灚绻涢崼婵堜虎闁哄鍠庨埞鎴︽倷鐠囇嗗惈濡ょ姷鍋涢崯瀛樻叏閳ь剟鏌曢崼婵囶棞濞存粍顨婇弻鐔兼嚌閻楀牆娑х紓鍌氱Т濡繂鐣烽鍌涘枂闁告洦浜炵粻姘舵⒑缂佹ê濮﹀ù婊勭矒閸┾偓妞ゆ帊鑳舵晶顏堟偂閵堝鐓涚€广儱娴锋禒婊勭箾閹寸們姘ｉ崼鐔稿弿婵☆垰銇橀崥顐︽煟閹烘垯鍋㈡慨濠冩そ瀹曘劍绻濋崘顭戞П闂備焦鎮堕崝鎴炵閸洖绠栭柨鐔哄У閸嬫劗绱撴担璇＄劷闁告瑥鍟埞鎴﹀煡閸℃浠ч柣鐘亾闁挎洍鍋撻摶锝夋煕椤愩倕鏋嶇紒璇叉閺屻倗鍠婇崡鐐差潻闂佸憡鏌ㄩ澶愬蓟閺囥垹鐐婄憸宥夘敂椤撶喆浜滈柕蹇婃閼板潡鏌熼鐣屾噰婵☆偄鍟埥澶愬箳閹存繄闃€濠电姴鐥夐弶搴撳亾濡や焦鍙忛柣鎴ｆ绾剧粯绻涢幋娆忕労闁轰礁瀚…璺ㄦ崉娓氼垳鍙曢梺鎼炲€栧ú鏍箒闂佺粯锚濡﹪宕曡箛娑樼畾闁绘柨鍚嬮埛鎴︽煙缁嬪灝顒㈡い銉ユ缁绘稒寰勭€ｎ偆顦梺杞扮贰閸犳牠鍩ユ径鎰潊闁抽敮鍋撻柟椋庣帛缁绘稒娼忛崜褍鍩岄梺纭咁嚋缁绘繈鐛崱娑橀唶闁靛濡囬崢杈ㄧ節閻㈤潧孝閻庢凹鍙冨畷鐢稿焵椤掆偓椤啴濡舵惔鈥崇闂佽绻戠换鍫ユ晲閻愬樊鐓ラ柛顐ｇ箘閸旓箑顪冮妶鍡楃瑨閻庢凹鍠栭悾鍨瑹閳ь剟寮婚悢鐓庣闁逛即娼у▓顓㈡⒑缂佹ɑ灏伴柣鈺婂灦瀵鈽夊Ο閿嬵潔闂佸憡顨堥崑鐐烘倶閸喓绠鹃悗娑欘焽閻銇勯妸銉含妤犵偛鍟悾锟犳焽閿旀儳寮抽梻浣告啞濞诧箓宕㈡ィ鍐╁仼闁绘挸绨堕弨?
   *
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛濠电姷顣换婵嗩焽瑜戦悘鎺楁⒑閸忚偐銈撮柡鍛箞閹偤宕楅懖鈺冾啎闂佸湱鍋撳娆撴倿瑜版帗鐓曢悗锝庡亝瀹曞矂鏌″畝鈧崰鏍€佸▎鎾崇畾鐟滃本绔熼弴銏♀拺闂傚牊绋撴晶宕囩磽瀹ュ嫮顦﹂柣锝呭槻椤粓鍩€椤掑嫬鏄ラ柨鐔哄Т缁€鍐煏婵炲灝鍓鹃柕澶嗘櫆閳锋帡鏌涚仦鍓ф噮妞わ讣绠撻弻鐔哄枈閸楃偘绨介梺閫炲苯澧柛鎴濈秺瀹曟粌鈽夐姀鐘殿唹闂侀潧绻堥崐鏇犵不閹惰姤鐓涢柛鎰剁到娴滈箖姊洪崫鍕棡缂侇喗鎹囧璇测槈閵忕姷鍔撮梺鍛婂姦娴滄牗鎱ㄩ崶顒佲拺?
   * - 闂傚倸鍊搁崐宄懊归崶顒夋晪鐟滃酣銆冮妷褏鐭欓柛鏌倐鍋撻崸妤佲拺妞ゆ巻鍋撶紒澶樺櫍閸┾偓妞ゆ帒锕﹂悾鐢碘偓瑙勬礈閸樠囧煘閹达箑绠涙い鎺嶇贰閸氭瑩姊婚崒娆愮グ妞ゆ洘鐗犲畷褰掓偨缁嬫寧妲梺鎼炲劘閸斿酣銆呴弻銉︾厽闁绘梻顭堝▍鐐垫喐閻楀牆绗氶柡鍛叀閺屾稑鈽夐崡鐐寸仌缂佺虎鍘搁崑鎾斥攽閿涘嫬浜奸柛濠冨姍瀵彃顭ㄩ崼鐔蜂簵闂佽法鍠撴慨鎾嫅閻斿吋鐓涢柛銉ｅ劚閻忊晠姊洪崡鐐村缂佺粯绻堝Λ鍐ㄢ槈濞嗘垯鍋愭繝纰樻閸嬫挾妲愰弴鐘愁潟闁规儳鐡ㄦ刊鎾煕濠靛棗鐝旈柨婵嗩槹閻撴洟鏌曟繛褍瀚В鍫濃攽閻橆偄浜炬繛鎾村焹閸嬫挻鎱ㄦ繝鍛仩缂佽鲸甯掗～婊堝幢濞嗗繐歇濠电姷鏁搁崑娑㈠箠韫囨拋娲偄閻撳海鐣哄┑顔姐仜閸嬫挻銇勯姀锛勬噰鐎规洘绮忛ˇ鎾煥濞戞瑧鐭掗柡灞稿墲瀵板嫭绻濋崟顐殽闂備礁鎲￠弻銊╂煀閿濆宓佸┑鐘叉搐瀹告繈鎮楀☉娆樼劷闁告ɑ鎹囬幃宄邦煥閸曨厾鐓夐悗瑙勬礃缁矂锝炲┑鍥ㄧ秶闁冲搫鍟伴崢顖炴⒒娴ｅ憡璐￠柛搴涘€濋妴鍐幢濞戞鏌у銈呯箰閹虫劗寮ч埀顒勬⒑濮瑰洤鐏叉繛浣冲棌鍙撮梻鍌欒兌椤牓顢栭崱娑樼濠电姵鑹炬闂佸憡娲﹂崰姘舵偪閳ь剟姊洪崷顓炰壕婵炲吋鐟х划锝呪槈閵忊檧鎷哄┑顔炬嚀濞层倝鍩€椤掍礁濮嶇€规洘鍨块獮妯肩礄閻樼數鐣鹃梻浣虹帛閸旓附绂嶅鍫濈劦妞ゆ帊鑳舵晶鐢碘偓瑙勬礃缁诲牓鐛€ｎ喗鏅濋柍褜鍓涙竟鏇°亹閹烘挾鍘搁梺鎼炲劗閺呮盯宕滈柆宥嗙厱闁靛牆妫欑粈鈧柧缁樼墵閺屻劌鈹戦崱妯烘闂佸搫妫涢崑銈夊蓟閿濆绠婚柛妤冨仜婵洜绱撴担铏瑰笡闁烩晩鍨堕悰顔锯偓锝庡枟閸婂鏌涢妷顖氼洭閺夆晜姊圭换婵堝枈濡嘲浜鹃柛鎰皺妤犲洭姊洪悷鐗堝暈濠电偛锕ら?isLocked=true闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弮鍫熸殰闁稿鎸剧划顓炩槈濡娅ч梺娲诲幗閻熲晠寮婚悢鍛婄秶闁告挆鍛闂佽瀛╅懝楣兯囨导鏉懳﹂柛鏇ㄥ灠缁犳娊鏌熺€涙绠ュù鐘靛帶閳规垿顢欏▎鐐秷闂佺粯鎼换婵嗩嚕婵犳碍鏅插璺猴功閻嫰姊虹粙鎸庢拱闁煎湱鍋撶粋鎺懳熼懖鈺冿紳婵炶揪绲介幖顐㈢摥闁诲孩顔栭崰鏍偉閸忛棿绻嗛柣銏㈩焾缁€瀣亜閺嶃劍鐨戦柣顐㈠濮婃椽骞栭悙鎻掑Ф闂佽绻戠换鍫ョ嵁濡偐纾兼俊顖炴敱鐎氫粙姊绘担鍛婂暈婵炶绠撳畷鎴﹀幢濡粯鐝￠梻鍌氬€风粈渚€骞栭銈嗗仏妞ゆ劧绠戠壕褰掓煛瀹ュ骸浜炵紒鎲嬬畵閺屻倝骞侀幒鎴濆缂備礁澧庨崑娑⑩€︾捄銊﹀磯闁惧繐婀辨导鍥р攽閻愬樊妲告繛灏栤偓鎰佹綎缂備焦蓱婵挳鏌涘☉姗堥練缁绢厸鍋撻梻鍌欒兌椤牆霉閻戣棄鏋侀悹鍥ф▕閸ゆ洟鏌＄仦璇插姕闁稿鍔欓幃褰掑炊椤忓嫮姣㈤梺浼欑稻濡炶棄顫忔繝姘妞ゆ劧绲介弸鐘绘煢濡崵绠為柡灞诲€楅崰濠囧础閻愬樊娼介梻浣告憸婵敻宕濆▎鎾宠摕闁绘梻鍎ゅ畷澶愭煟濮橆厽缍戝ù鍏煎姍濮婃椽鎮烽弶鎸庢瘣缂備胶绮敮锟犲春閳?
   * - 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊椤掑鏅悷婊冪箻閸┾偓妞ゆ帊鑳堕埢鎾绘煛閸涱喚绠橀柛鎺撳笒閳诲酣骞樺畷鍥跺敽婵犲痉鏉库偓鎾绘倿閿曗偓閳诲秹寮惔鎾存杸闂佺粯锚閻忔岸寮抽埡浣叉斀妞ゆ洖鎳庡顔锯偓瑙勬礃閸ㄥ潡鐛Ο鍛靛酣顢栫捄銊ф晨闂傚倸顭崑鍕洪敃鍌氱闁绘劦鍓氬▍鐘绘煛閸ャ儱鐏柛濠傜仛閹便劌顫滈崱妤€鈷掑┑鈩冨絻閹诧繝濡甸崟顖ｆ晣闁斥晛鍟伴妴濠囨⒑閸︻厽鍤€閻庢凹鍘剧划顓㈡偄绾拌鲸鏅┑顔斤供閸撴瑩藟鎼粹檧鏀介柣妯虹仛閺嗏晠鏌涚€ｎ偆娲存鐐诧攻閹棃鏁愰崱妤€绨ユ繝娈垮枟閵囨盯宕戦幘鎼闁绘劖褰冮弳娆撴煟閿濆繒绡€妤犵偛绉归幖褰掝敃閵堝倸浜鹃悹鍥ㄧゴ閺€浠嬫煟閹邦剙绾фい銉у仱閺屾盯濡歌閺€浼存煃椤忓棙鏆慨濠傤煼瀹曟帒鈻庨幇顔哄仒闂備線娼уΛ宀勫磻閹剧粯鈷戠紒瀣儥閸庢劙鏌熼悷鐗堝枠鐎殿喖顭锋俊鎼佸Ψ閵忊剝鏉搁梻浣虹《濡狙囧疾濠婂懐鎳呯紓鍌氬€搁崐鐑芥嚄閼稿灚鍙忛柛顭戝亞缁犳儳鈹戦悩鍙夋悙闁藉啰鍠愮换娑㈠箣濞嗗繒鍔撮梺杞扮閸熸挳寮婚弴銏犻唶婵犻潧娲ゅ▍銈夋⒑鐠囨煡顎楀褏鏅Σ鎰板箻鐠囪尙锛滃┑顔缴戦惁宄邦煥閸喓鍘遍柣搴秵閸嬪懎鐣风仦鐐弿濠电姴瀚敮娑㈡煙瀹勭増鍤囬柟顔惧厴閺屽洭鏁冮埀顒€鈻撳┑鍫㈢＝闁稿本鐟чˇ锔姐亜閹存繃顥㈢€规洖缍婇幃鐣屽寲閺囨浜鹃柨鏇炲€搁悙濠冦亜閹哄秶顦﹂柛鎿冨幗缁绘盯骞嬮悙绮规嫽濡炪値鍋嗛崜绛nlock_grants 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧鏌ｉ幇顒佹儓闁搞劌鍊块弻娑㈩敃閿濆棛顦ョ紓浣哄С閸楁娊骞冭ぐ鎺戠倞鐟滃酣鍩㈤弴鐔虹闁稿繗鍋愭晶鐢告煛瀹€瀣М闁诡喓鍨归悾锟犲箥椤旂偓鏅ㄩ梻鍌欐祰閸嬫劖鏅跺Δ鍐ｅ亾缁楁稑娲ゆ闂佸憡娲﹂崹鎵不婵犳碍鍋ｉ柧蹇曟嚀閸斿鏌ｆ惔锝呬壕缂佺粯绋撻埀顒佺⊕閿氭繛鍫㈠█閺屾稒绻濋崘顏嗙杽閻庢鍠涢褔鍩ユ径鎰潊闁绘ɑ鐗撻崝鎴﹀蓟閵娿儮鏀介柛鈩兠▍锝咁渻閵堝骸澧い锕傛涧椤繘鎼归悷鏉款嚙闂佸搫娲ㄩ崰鎰版偟閺冨牊鈷戠紒瀣皡瀹搞儲绻涚亸鏍ゅ亾閹颁礁娈ㄦ繝鐢靛У閼圭偓鍎梻渚€娼чˇ顓㈠垂濞差亷缍栫€广儱鎳夐弨鑺ャ亜閺冨倻鎽傛繛鍫熸⒐娣囧﹪顢曢敐鍥ㄥ櫑闂佺儵妲呴崣鍐潖?isLocked=false闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弮鍫熸殰闁稿鎸剧划顓炩槈濡娅ч梺娲诲幗閻熲晠寮婚悢鍛婄秶濡わ絽鍟宥夋⒑閹肩偛鈧牠宕濋弽顓炍﹂柛鏇ㄥ灠閸愨偓闂侀潧臎閸涱垳鐛ユ繝鐢靛仜閻°劎鍒掑畝鈧槐鐐寸節閸パ嗘憰闂侀潧鐗嗗ú銈夊几閸儲鐓曟俊銈呭暙娴犳粍銇勯顐簽缂佽鲸甯￠獮鍡氼槻缂傚秵鐗滅槐鎺楊敊閻ｅ本鍣伴悗娈垮枛椤兘宕规ィ鍐ㄧ疀濞达絽鎲￠崐顖炴⒑绾懎浜归悶娑栧劦閸┾偓妞ゆ帊绀佹晶顖涚箾婵傚摜鐣烘慨?
   * - 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸ゅ嫰鏌涢锝嗙５闁逞屽墾缁犳挸鐣锋總绋款潊闁炽儱鍟跨花銉╂⒒娴ｇ儤鍤€闁宦板妿閹广垽骞囬悧鍫濇畬闂佺鍕垫畷闁绘挻娲熼弻銊╁籍閸ヨ泛娈Δ鐘靛仦閻楃娀寮诲☉銏犖╅柨鏂垮⒔閻ｆ椽姊洪棃娑欐悙閻庢矮鍗抽悰顕€骞掑Δ鈧粻锝嗙節閸偄濮冮柟顕嗙悼缁辨捇宕掑▎鎺戝帯婵犳鍣ｅ褔鎮惧┑瀣濞达絾鐡曢幗鏇炩攽閻愭潙鐏﹂懣銈嗕繆閹绘帞澧﹂柡灞剧☉铻栭柛鎰╁妺缁墎绱撴担鍝勑㈢紓宥咃工椤?闂?isLocked=false闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弮鍫熸殰闁稿鎸剧划顓炩槈濡娅ч梺娲诲幗閻熲晠寮婚悢鍛婄秶濡わ絽鍟宥夋⒑閹肩偛鈧牠宕濋弽顓炍﹂柛鏇ㄥ灠閸愨偓闂侀潧臎閸涱垳鐛ユ繝鐢靛仜閻°劎鍒掑畝鈧槐鐐寸節閸パ嗘憰闂侀潧鐗嗗ú銈夊几閸儲鐓曟俊銈呭暙娴犳粍銇勯顐簽缂佽鲸甯￠獮鍡氼槻缂傚秵鐗滅槐鎺楊敊閻ｅ本鍣伴悗娈垮枛椤兘宕规ィ鍐ㄧ疀濞达絽鎲￠崐顖炴⒑绾懎浜归悶娑栧劦閸┾偓妞ゆ帊绀佹晶顖涚箾婵傚摜鐣烘慨?
   */
  async getMonthData(packageId: number, monthNo: number, user: RequestUserScope) {
    const pkg = await this.findPackageOrThrow(packageId);
    this.verifyCityOwnership(pkg, user);

    // 闂傚倸鍊搁崐宄懊归崶顒夋晪鐟滃酣銆冮妷褏鐭欓柛鏌倐鍋撻崸妤佲拺妞ゆ巻鍋撶紒澶樺櫍閸┾偓妞ゆ帒锕﹂悾鐢碘偓瑙勬礈閸樠囧煘閹达箑绠涙い鎺嶇贰閸氭瑩姊绘担钘夊惞濠殿喗鍎抽埢宥夋晲閸ワ妇鍓ㄩ梺闈浥堥弲婊堝吹閳ь剟姊洪崜鑼帥闁哥喐妫侀妵鎰板箳閹惧瓨鐝抽梻浣规偠閸庮垶宕濆澶嬪仧妞ゅ繐鐗婇埛鎴炴叏閻熺増鎼愰柍褜鍓氶崝娆忕暦閹达箑绠荤紓鍫㈠Х缁犳岸姊虹紒妯哄Е濞存粍绮撻崺鈧い鎺嶈兌婢х數鈧娲樼换鍫ョ嵁鐎ｎ喗鏅濋柍褜鍓涙竟鏇°亹閹烘挾鍘搁梺鎼炲劗閺呮盯宕滈柆宥嗙厱闁靛牆妫欑粈瀣煛瀹€鈧崰鏍€佸☉銏犲耿闊洦鎸锋竟鏇熺節绾版ê澧茬憸鏉垮暣閹囧箻鐠囪尪鎽曢梺缁樻⒒閸樠呯不濮樿鲸鍠愰煫鍥ㄧ☉缁犳椽鏌ｅΟ鑲╁笡闁绘挸鍟村娲垂椤曞懎鍓版繝娈垮枛閻楀棜褰侀梺鎼炲劀瀹ュ牆鎯堟俊鐐€戦崹鍝劽洪悢鐓庣畺闁宠桨鎬ラ崷顓涘亾閿濆簼绨峰瑙勬礀閳规垿鎮╃紒妯婚敪濠碘槅鍋掗崣鍐ㄧ暦閻㈢鍗抽柕蹇ョ磿閸樺崬顪冮妶搴″箺闁搞劌鐏氱粋宥咁煥閸涱垳锛滈梺鍛婃尫缁€浣圭闁秵鐓欐い鏃傜摂濞堟粓鏌℃担鐟板闁诡垱妫冮崹楣冩嚑椤掆偓閸ゎ剟姊婚崒娆掑厡缂侇噮鍨抽幑銏ゅ箛椤旇棄搴婂┑鐘绘涧椤戝懘鎷戦悢鍏肩叆婵犻潧妫Σ褰掓煕鐎ｎ亜顏柡灞剧☉閳规垿宕熼銏狀潥闂備焦鎮堕崐鏇㈠磹閼姐倖顫曢柟鎹愵嚙绾惧吋鎱ㄥΟ鑽ゆ▊闁挎稑瀚壕濂告煠闂€鎰シ濠㈣蓱閵?闂?闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箻閺岀喓绱掗姀鐘崇亪缂備胶濮鹃～澶愬Φ閸曨垰绠涢柛顐ｆ礃椤庡秹姊虹粙娆惧剾濞存粠浜璇测槈閵忕姈銊╂煏韫囧﹤澧查柣婵囨礋閹鎲撮崟顒傤槰闂佺粯鎼换婵嗩嚕鐠囨祴妲堥柕蹇曞Х閻も偓闂傚倸鍊搁悧濠勭矙閹烘鍊堕柛顐犲灮绾捐棄霉閿濆懏鎯堥崯鍛婄節閻㈤潧浜归柛瀣崌濮婃椽宕崟顓犱紘闂佸摜濮甸悧鐘荤嵁閸愵煈鐓ラ柛蹇撳⒔閸犳牠骞栬ぐ鎺撶劵婵炴垶鐟﹂埢鏇熺節绾板纾块柛瀣灴瀹曟劙濡舵径濠勶紱闂佽鍎虫晶搴ｇ矆婵犲伅褰掓晲閸涱収妫岄梺鎼炲€栧ú鐔煎蓟濞戙埄鏁冮柨婵嗘椤︺劑姊虹粙鍖″姛闁稿繑锕㈠濠氬Χ婢跺﹤绐涙繝鐢靛Т妤犳悂寮查崡鐐╂斀闁宠棄妫楁禍婊堟倵濮橆厽绶叉い顐㈢箰鐓ゆい蹇撳椤旀劙姊虹紒妯哄鐟滄澘鍟撮垾鏍醇閵夛腹鎷洪柣鐘叉穿鐏忔瑧绮婚懠顑藉亾閸忓浜鹃梺褰掓？閼宠泛鐣垫笟鈧弻娑㈩敃閻樻彃濮庨柟顖滃枛閹嘲顭ㄩ崘鐐枅閻庤娲橀崹鍧楃嵁濡偐纾兼俊顖滅帛閻濇娊姊洪崷顓炲付闁宦板妿閹广垽宕熼娑樺壆闁硅偐琛ュΣ鍛€掓繝姘厪闁割偅绻冮ˉ鐐烘煠閼碱剙鈻堥柡灞剧洴婵＄兘鏁愰崨顓х€烽梻浣告啞閻熴儱螞濡ゅ懎鐓橀柟杈鹃檮閸婄兘鏌℃径瀣仼濞寸姷顭堥—鍐Χ鎼粹€崇濠电偠顕滅粻鎾愁嚕閼碱剚宕夐悶娑掑墲椤秴鈹戦鏂や緵闁告ê銈稿鎼佸箣閻愭壆绠氬銈嗗姧鐎靛矂寮抽幒妤佺厾闁告劘灏欓崺锝団偓瑙勬礃缁诲倿顢樻總绋跨倞闁冲搫鍠涚槐鏌ユ⒒娴ｄ警鐒鹃柡鍫墮椤繈濡搁敂鑺ョ彙濠电姷鏁告慨鐑姐€傛禒瀣劦妞ゆ巻鍋撶痪缁㈠弮瀹曟椽鏁愰崶锝呬壕閻熸瑥瀚粈鈧悗瑙勬处閸撴繈鎮橀幒妤佲拺闁稿繗鍋愰妶鎾煛閸涱喚鐭婇柍缁樻崌楠炴牗鎷呴崗澶嬪?read-only闂?
    const existingSnapshot = await this.snapshotRepo.findOne({
      where: { packageId, belongMonth: monthNo },
    });
    if (existingSnapshot) {
      const activeGrant = await this.unlockGrantRepo.findOne({
        where: { packageId, monthNo, expiresAt: MoreThan(new Date()) },
        select: ['id'],
      });
      const isLocked = !activeGrant;
      if (isLocked) {
        const contractRows = await this.contractRowRepo.find({
          where: { packageId, monthNo },
        });
        const [costRows, maintenanceRows] = await Promise.all([
          this.costRowRepo.find({ where: { packageId, monthNo } }),
          this.maintenanceRowRepo.find({ where: { packageId, monthNo } }),
        ]);
        return this.assembleSnapshotMonthResponse(
          pkg,
          monthNo,
          existingSnapshot,
          contractRows,
          costRows,
          maintenanceRows,
        );
      }
    }
    const existingContractRows = await this.contractRowRepo.find({
      where: { packageId, monthNo },
      order: { id: 'ASC' },
    });

    // 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇氱秴闁搞儺鍓﹂弫鍐煥閺囨浜鹃梺姹囧€楅崑鎾舵崲濞戙垹绠ｉ柣鎰ㄦ櫆閿涘牆鈹戦悙鍙夆枙濞存粍绻堝鎻掆攽鐎ｎ偆鍘遍柣蹇曞仧閸嬫捇鎯冮幋鐐簻闁哄倹瀵ч崵鍥ㄦ叏婵犲啯銇濇俊顐㈠暙閳藉顫濋澶嬫瘒濠碉紕鍋戦崐褏绱撳璺虹闁告劕妯婇崵鏇㈡煛鐏炶鍔撮柡浣告闇夐柨婵嗘处閸も偓閻庢鍠栭悘婵嬪煘閹达富鏁婄紒娑橆儐閻ｈ泛鈹戦埥鍡椾簼妞ゃ劌妫涚划瀣吋婢跺鈧兘鏌ｉ幋鐑嗙劷闁告妫勯—鍐Χ閸℃ê鏆楅梺绋款儑婵兘鍩€椤掍胶鐓柛妤佸▕楠炲﹪鏁愭径濠勭杸闂佺粯顨呴悧蹇涘储闁秵鈷戦梻鍫熶緱濡狙呯磼閼艰泛袚濞ｅ洤锕﹂幑鍕Ω瑜忛敍婊堟⒑缂佹﹩鐒芥い鎺撶叀閹虫捇宕稿Δ浣哄幐閻庡厜鍋撻悗锝庡墰閻﹀牓鎮楃憴鍕缂侇喖澧界划璇测槈閵忕姷顔掗梺鍦帛鐢晛螞濠婂牊鈷掗柛灞捐壘閳ь剚鎮傚畷鎰槹鎼达絿鐒兼繛鎾村焹閸嬫挻顨ラ悙宸█闁轰焦鎹囬幃鈺呭礃閸欏鏉芥繝寰锋澘鈧呭緤娴犲鐤い鏍仜绾惧鎮楅敐搴℃灍闁绘挻娲熼弻宥夊煛娴ｅ憡娈堕梺瀹犳椤﹁京妲愰幒妤佸亹鐎规洖娲ら埛宀勬⒑閸濆嫮鐏遍柛鐘崇墵閻涱噣宕卞鍏碱€囬梻浣规偠閸婃宕伴幇鏉课﹂柛鏇ㄥ灠閻撴盯鏌涘鈧悞锕偹夐弽顓熲拺闂侇偆鍋涢懟顖涙櫠椤斿墽纾奸柣妯垮皺鏁堥悗瑙勬礃濞茬喖寮婚崱妤婂悑闁告侗鍨抽弸鍐⒒娴ｅ憡璐″褎顨呴…鍨熼懖鈺€绗夊┑鐐叉▕娴滄繈鎮￠悢闀愮箚妞ゆ牗绻傛禍褰掓偨椤栨稓娲撮柡宀嬬秮楠炴鈧稒顭囬ˇ浼存⒑閸濆嫯顫﹂柛鏃€鍨甸锝夘敆閸曨偆顔囬柟鍏肩暘閸ㄥ綊宕滈棃娑掓斀闁绘灏欏Λ鍕煏閸繃锛嶅ù鐘櫇缁辨挻鎷呮禒瀣懙闁汇埄鍨辩敮鐔兼倶閸愨晝绠鹃弶鍫濆⒔閸掍即鏌熺喊鍗炰喊闁糕晜绋戦悾婵嬪礋椤掆偓閳ь剙鐏氱换娑㈠醇濠靛牅铏庨梺鍝勵儍閸婃繈寮婚埄鍐╁闁告捁灏欓崥瀣⒑闂堟稒顥欑紒鑸佃壘椤曪綁顢氶埀顒€鐣烽悡搴樻斀闁割偅绺鹃崑鎾绘倷瀹割喗瀵岄梺闈涚墕閹虫劗绮绘导瀛樼厵闁告劖鐓￠崣鍕亜閵忊剝顥堥柛鈺嬬節瀹曘劑顢欑憴鍕伜婵犵數鍋犻幓顏嗗緤娴犲绠熼柨鐔哄Т閻ゎ噣鏌ｉ幇顔煎妺闁稿鍔嶉妵鍕冀閵娧呯厐婵炲濯存俊鍥╂閹烘梻纾兼俊顖氬悑閸掓盯姊虹化鏇熸澒闁稿鎸搁—鍐Χ閸℃鐟愰梺鐓庡暱婢у海鍒掔紒妯稿亝闁告劏鏅濋崢鍗炩攽閻愭潙鐏ョ€规洦鍓欓锝夘敋閳ь剟寮诲☉妯锋瀻闊洦鎼╂导鍐⒑閸濆嫮鐏遍柛鐘崇墵閵嗕礁鈽夊鍡樺兊濡炪倖甯婇悞锕傤敊閹烘鐓熼幖娣€ゅ鎰箾閸欏鐭掔€规洑鍗冲浠嬵敇濠ф儳浜惧ù锝呭濞尖晠鎮归崫鍕儓缂佹劖绋戦—鍐Χ閸℃﹩姊挎繝娈垮枔閸婃洟鈥?
    const existingContractIds = existingContractRows
      .map((row) => Number(row.contractId))
      .filter((id) => Number.isFinite(id));

    const activeContracts = existingContractIds.length > 0
      ? await this.contractRepo.find({
          where: { id: In(existingContractIds), isDeleted: SoftDeleteFlag.NOT_DELETED },
          select: ['id'],
        })
      : [];

    const activeContractIdSet = new Set(activeContracts.map((c) => Number(c.id)));

    let resolvedContractRows = existingContractRows.filter((row) =>
      activeContractIdSet.has(Number(row.contractId)),
    );

    // Backfill missing draft-month contract rows from current allocations
    // - Initialize all rows when none exist
    // - Add newly allocated contracts when only some rows already exist
    const allocations = await this.allocationRepo.find({
      where: { cityId: pkg.cityId },
    });
    if (allocations.length > 0) {
      const allocContractIds = allocations.map((a) => Number(a.contractId));
      const contracts = await this.contractRepo.find({
        where: { id: In(allocContractIds), isDeleted: SoftDeleteFlag.NOT_DELETED },
      });
      const contractMap = new Map(contracts.map((c) => [c.id, c]));
      const existingResolvedContractIdSet = new Set(
        resolvedContractRows.map((row) => Number(row.contractId)),
      );

      const newRows: ContractMonthRowEntity[] = [];
      for (const alloc of allocations) {
        const cId = Number(alloc.contractId);
        const contract = contractMap.get(cId);
        if (!contract || existingResolvedContractIdSet.has(cId)) {
          continue;
        }

        newRows.push(
          this.contractRowRepo.create({
            packageId,
            contractId: cId,
            contractCodeSnapshot: contract.contractCode,
            contractNameSnapshot: contract.contractName,
            cityAllocationId: alloc.id,
            monthNo,
            completionAmount: 0,
            acceptanceAmount: 0,
            invoiceAmount: null,
            orderAmount: null,
            isLocked: ContractRowLockStatus.UNLOCKED,
            lockReason: null,
          }),
        );
      }

      if (newRows.length > 0) {
        await this.contractRowRepo.save(newRows);
      }

      if (newRows.length > 0 || resolvedContractRows.length === 0) {
        const allRows = await this.contractRowRepo.find({
          where: { packageId, monthNo },
          order: { id: 'ASC' },
        });
        // Re-validate all rows after re-read because stale rows may still exist
        const allContractIds = allRows
          .map((row) => Number(row.contractId))
          .filter((id) => Number.isFinite(id));
        const validContracts = allContractIds.length > 0
          ? await this.contractRepo.find({
              where: { id: In(allContractIds), isDeleted: SoftDeleteFlag.NOT_DELETED },
              select: ['id'],
            })
          : [];
        const validIdSet = new Set(validContracts.map((c) => Number(c.id)));
        resolvedContractRows = allRows.filter((row) =>
          validIdSet.has(Number(row.contractId)),
        );
      }
    }

    const [costRows, maintenanceRows] = await Promise.all([
      this.costRowRepo.find({ where: { packageId, monthNo } }),
      this.maintenanceRowRepo.find({ where: { packageId, monthNo } }),
    ]);

    // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴濐潟閳ь剙鍊块幐濠冪珶閳哄绉€规洏鍔戝鍫曞箣閻欏懐骞㈤梻鍌欑窔閳ь剛鍋涢懟顖涙櫠閹绢喗鐓涢悘鐐插⒔閵嗘帡鏌嶈閸撱劎绱為崱娑樼；闁告侗鍘鹃弳锔锯偓鍏夊亾闁告洦鍓涢崢鎼佹倵閸忓浜鹃柣搴秵閸撴盯鏁嶉悢鍝ョ閻庣數顭堥鎾斥攽閳ヨ櫕鍠樻鐐茬箻閹晝鎷犻懠顒夊斀闂備礁婀遍崕銈夊春閸繍鐒介柕澶堝劗閺€浠嬫煟濡椿鍟忛柡鍡╁灦閺屽秷顧侀柛鎾寸懇瀹曨垳鎹勯妸褎锛忛悷婊勬瀵鎮㈢喊杈ㄦ櫓闂佺粯鎸哥花鍫曞磻閹捐绠瑰ù锝囨嚀娴犲ジ姊虹紒妯虹伇婵☆偄瀚弫顕€姊绘担绋挎毐闁圭⒈鍋婂畷鎰版偡閹佃櫕鐎洪梺鎼炲労閸撴岸鍩涢幋锔解拺妞ゆ劑鍊曟禒婊堟煠濞茶鐏￠柡鍛閳ь剛鏁哥涵鍫曞磻閹捐埖鍠嗛柛鏇ㄥ墰椤︺劑姊洪懡銈呮毐闁哄懐濮撮锝夘敃閿曗偓缁犺崵绱撴担濮戭亝绂嶈ぐ鎺撯拺闁革富鍘剧敮娑㈡偨椤栨粌浠╅柕鍥ㄥ姈瀵板嫭绻涢悙顒佹澑闂備胶绮敃鈺呭窗閺嶎厽鍊堕弶鍫涘妿缁犳儳顭跨捄渚剳婵炴彃鐡ㄩ妵鍕閿涘嫬鈷岄悗瑙勬磸閸旀垿銆佸☉姗嗘僵閺夊牃鏅濋幗宀勬⒒閸屾瑦绁扮€规洜鏁诲畷浼村箛閺夊潡妫烽梺鍦檸閸犳宕戦敓鐘崇厵濞达絽鍟悵顏堟煛娴ｅ搫鈻堟慨濠冩そ瀹曟粓鎳犻鈧敮銉╂⒑閸濄儱校閻㈩垪鈧磭鏆﹂柟杈剧畱缁犲鎮归崶銊ョ祷鐎规挸妫濆娲濞戞氨顔婃繝娈垮枤閸忔﹢銆佸▎蹇曟殕闁告洦鍏橀幏娲⒑閸涘﹤濮囩€殿喖鐖奸獮鍡涘醇閵夛妇鍘甸梺鍛婂姌鐏忔瑧绮婚懡銈傚亾鐟欏嫭绀冮柛銊ョ仢閻ｇ兘骞掗幋顓犲弳闂佸憡娲﹂崑鍛存倵閻愵剛绡€闁汇垽娼ч埢鍫熺箾娴ｅ啿娲﹂崑瀣攽閻樺弶绁紓宥嗙墵閺岋繝宕堕埡浣圭亖缂備胶濞€缁犳牠寮诲☉銏犵労闁告劗鍋撻悾椋庣磽娴ｇ鈧悂顢栨径鎰摕婵炴垯鍨洪崑鍕⒑閸噮鍎忔繛鍫燁殜濮婃椽宕崟顒佹嫳缂備礁顑嗛崹鍧楀春閵忊剝鍎熼柕鍫濇川閺夋悂姊洪幐搴ｇ畵闁哄苯锕弫鍌炲礈瑜忛敍婵囩箾鏉堝墽绉俊顐㈠閹啫煤椤忓懐鍘甸梺鎯ф禋閸嬪懎鐣风仦鍓х瘈闁?闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛濠电姷顣换婵嗩焽瑜戦悘鎺楁⒑閸忚偐銈撮柡鍛箞閹偤宕楅懖鈺冾啎闂佸湱鍋撳娆撴倿瑜版帗鐓曢悗锝庡亝瀹曞矂鏌″畝鈧崰鏍€佸▎鎾崇畾鐟滃本绔熼弴銏♀拺闂傚牊绋撴晶宕囩磽瀹ュ嫮顦﹂柣锝呭槻椤粓鍩€椤掍椒绻嗛柟闂寸劍閺呮粓鏌涘▎妯轰簼鐎光偓缁嬫娼栫紓浣股戞刊鎾煟閻斿憡绶插┑顔哄灮缁辨挻鎷呴搹鐟扮濡炪們鍔岄敃顏堝Υ娴ｅ壊娼╅悹鍝勬惈閸炪劌顪冮妶鍡樺暗闁稿鍠栧畷顐⑽旈崨顔规嫼闂傚倸鐗婇崡鏇㈠醇閵夈儳鏌у┑鐘诧工閻楀﹪宕戦崒鐐寸厽闁哄啫鐗婂▍婊呯磼鐠囧弶顥為柕鍥у瀵粙濡搁敂鐐吇濠电偛顕慨浼村垂娴犲钃熼柨婵嗩槸缁犲鏌℃径瀣仴妞ゎ偅甯″娲传閸曨喖顏紓浣割槺閸忔鐦繛鎾村焹閸嬫捇鏌＄仦鍓ь灱缂佺姵鐩顕€宕掑Ο宄颁壕闁圭儤鎸剧粻楣冩煕閳╁啫濮囬柣蹇斿絻閳规垿鍨惧畷鍥х厽閻庤娲栭悥濂稿灳閿曞倸绠ｉ柣鎰暩閳?
    const snapshot = existingSnapshot || await this.snapshotRepo.findOne({
      where: { packageId, belongMonth: monthNo },
      select: ['id'],
    });

    let isLocked = false;
    let lockReason: string | null = null;

    if (snapshot) {
      const activeGrant = await this.unlockGrantRepo.findOne({
        where: {
          packageId,
          monthNo,
          expiresAt: MoreThan(new Date()),
        },
        select: ['id'],
      });

      if (!activeGrant) {
        isLocked = true;
        lockReason = 'This month is already submitted. Please contact an admin to unlock it.';
      }
    }

    return this.assembleMonthResponse(pkg, monthNo, resolvedContractRows, costRows, maintenanceRows, isLocked, lockReason, Boolean(snapshot));
  }

  /**
   * 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闂囧鏌ㄥ┑鍡欏闁逞屽厴閸嬫捇姊虹粙娆惧剱闁瑰憡鎮傞敐鐐测攽鐎ｎ偄浜楅柟鑹版彧缁茬厧顩奸幘缁樷拺?getMonthData 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴鐐测偓褰掑磿閹寸姵鍠愰柣妤€鐗嗙粭鎺旂磼閳ь剚寰勭仦绋夸壕闁稿繐顦禍楣冩⒑闁偛鑻晶鎾煕閳规儳浜炬俊鐐€栫敮濠勭矆娓氣偓瀹曠敻顢楅崟顒傚幈闂佺粯锚閸熷潡宕搹鍏夊亾鐟欏嫭绀冪€光偓閹间胶宓侀柟鐑樺殾閺冣偓閹峰懐鍖栭弴鐐板缂傚倷鐒︾湁缂佽妫欓妵鍕冀閵婏妇娈ゅ┑顕嗙悼閸嬨倝寮婚敍鍕ㄥ亾閿濆骸浜炲褍鐏氶幈銊︾節閸愨斂浠㈤梺鍝勮嫰閹虫﹢骞冨▎鎾村殤閻犺桨璀︽导鍐ㄢ攽閻橆偅濯伴柛鎰劤濞堝爼姊洪柅鐐茶嫰婢у弶銇勯銏╂Ц閻撱倝鏌ㄩ弴鐐测偓鍝ュ婵犳碍鐓曢柡鍥ュ妼閻忛亶鏌℃担鍛婃悙闁宠鍨垮畷鎺戭煥鎼达絽濮奸柣搴ｆ嚀閹诧紕鎹㈤崘顔嘉﹂柛鏇ㄥ灠閸愨偓闂侀潧顭俊鍥р枔閵堝鈷戦柛婵嗗椤ョ偞鎱ㄦ繝鍛惞婵″弶鍔欓獮妯兼嫚閼碱剨绱叉繝娈垮枟閿曗晠宕楀鈧畷鎴﹀箻缂佹ê鈧鏌ら幁鎺戝姎闁逞屽墮濞硷繝寮婚妸鈺佸嵆闁绘劖绁撮崑鎾诲传閵壯傜瑝闂佸搫顦花閬嶅绩娴犲鐓熸俊顖濇閿涘秵銇勯敐鍡欏弨闁?
   */
  private assembleSnapshotMonthResponse(
    pkg: AnnualPackageEntity,
    monthNo: number,
    snapshot: MonthSnapshotEntity,
    currentContractRows: ContractMonthRowEntity[],
    _currentCostRows: CostMonthRowEntity[],
    _currentMaintenanceRows: MaintenanceMonthRowEntity[],
  ) {
    const snapshotContractRows = Array.isArray(snapshot.contractRowsJson)
      ? snapshot.contractRowsJson.filter((row: unknown): row is Record<string, unknown> => typeof row === 'object' && row !== null)
      : [];
    const snapshotByContractId = new Map(
      snapshotContractRows.map((row) => [Number(row.contractId), row]),
    );
    const mappedCurrentRows = currentContractRows.map((row) => {
      const saved = snapshotByContractId.get(Number(row.contractId));
      return {
        contractId: row.contractId,
        contractCode: row.contractCodeSnapshot,
        contractName: row.contractNameSnapshot,
        completionAmount: this.toFiniteNumber(saved?.completionAmount),
        acceptanceAmount: this.toFiniteNumber(saved?.acceptanceAmount),
        invoiceAmount: this.toFiniteNumber(saved?.invoiceAmount),
        orderAmount: this.toFiniteNumber(saved?.orderAmount),
      };
    });
    const currentIds = new Set(currentContractRows.map((row) => Number(row.contractId)));
    const snapshotOnlyRows = snapshotContractRows
      .filter((row) => !currentIds.has(Number(row.contractId)))
      .map((row) => ({
        contractId: Number(row.contractId),
        contractCode: String(row.contractCode || row.contractCodeSnapshot || ''),
        contractName: String(row.contractName || row.contractNameSnapshot || ''),
        completionAmount: this.toFiniteNumber(row.completionAmount),
        acceptanceAmount: this.toFiniteNumber(row.acceptanceAmount),
        invoiceAmount: this.toFiniteNumber(row.invoiceAmount),
        orderAmount: this.toFiniteNumber(row.orderAmount),
      }));
    const snapshotCostRows = Array.isArray(snapshot.costRowsJson)
      ? snapshot.costRowsJson.filter((row: unknown): row is Record<string, unknown> => typeof row === 'object' && row !== null)
      : [];
    const maintenance = snapshot.maintenanceRowsJson && typeof snapshot.maintenanceRowsJson === 'object'
      ? snapshot.maintenanceRowsJson as Record<string, unknown>
      : null;

    return {
      packageId: pkg.id,
      cityId: pkg.cityId,
      reportYear: pkg.reportYear,
      status: pkg.status,
      monthNo,
      contractRows: [...mappedCurrentRows, ...snapshotOnlyRows],
      costRows: snapshotCostRows.map((row) => ({
        costCategoryCode: String(row.costCategoryCode || ''),
        amount: this.toFiniteNumber(row.amount),
      })),
      maintenanceRow: maintenance
        ? {
            invoiceTotalPrevYear: this.toFiniteNumber(maintenance.invoiceTotalPrevYear),
            invoiceMonthCountPrevYear: this.toFiniteNumber(maintenance.invoiceMonthCountPrevYear),
            invoiceTotalCurrentYear: this.toFiniteNumber(maintenance.invoiceTotalCurrentYear),
          }
        : null,
      isLocked: true,
      isSubmitted: true,
      lockReason: 'This month is already submitted. Please contact an admin to unlock it.',
    };
  }
  private assembleMonthResponse(
    pkg: AnnualPackageEntity,
    monthNo: number,
    contractRows: ContractMonthRowEntity[],
    costRows: CostMonthRowEntity[],
    maintenanceRows: MaintenanceMonthRowEntity[],
    isLocked: boolean,
    lockReason: string | null,
    isSubmitted: boolean,
  ) {
    return {
      packageId: pkg.id,
      cityId: pkg.cityId,
      reportYear: pkg.reportYear,
      status: pkg.status,
      monthNo,
      contractRows: contractRows.map((r) => ({
        contractId: r.contractId,
        contractCode: r.contractCodeSnapshot,
        contractName: r.contractNameSnapshot,
        completionAmount: r.completionAmount,
        acceptanceAmount: r.acceptanceAmount,
        invoiceAmount: r.invoiceAmount,
        orderAmount: r.orderAmount,
      })),
      costRows: costRows.map((r) => ({
        costCategoryCode: r.costCategoryCode,
        amount: r.amount,
      })),
      maintenanceRow:
        maintenanceRows.length > 0
          ? {
              invoiceTotalPrevYear: maintenanceRows[0].invoiceTotalPrevYear,
              invoiceMonthCountPrevYear: maintenanceRows[0].invoiceMonthCountPrevYear,
              invoiceTotalCurrentYear: maintenanceRows[0].invoiceTotalCurrentYear,
            }
          : null,
      isLocked,
      lockReason,
      isSubmitted,

    };
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲忛崕鎶藉焵椤掑﹦绉甸柛鐘崇墱婢规洟宕稿Δ浣哄幍闂佽鍨虫晶妤吽夋径鎰闁哄鍩婇煬顒勬煛鐏炶鈧繈骞婂┑瀣妞ゆ棁鍋愭晶顖氣攽閻愯尙鎽犵紒顔肩灱缁辩偞绻濋崶褑鎽曞┑鐐村灟閸ㄧ懓鏁俊鐐€栧濠氬储瑜旈敐鐐哄煛閸涱喒鎷哄┑鐐跺蔼椤曆囩嵁濡や降浜滈柕濞垮劜椤ャ垹鈹戦敍鍕毈鐎规洜鍠栭、娆撳礈瑜庡鎴︽⒒娴ｇ瓔娼愰柛搴㈠▕椤㈡岸顢橀姀鐘栄囨煃閸濆嫭鍣洪柍閿嬪灴閺岀喖鎳栭埡浣风捕闂侀€炲苯澧柛銊ョ仢閻ｉ鎲撮崟顓ф祫闁诲函缍嗘禍锝夊箺閺囩偐鏀介柣鎰綑閻忥附銇勯鐐测偓鍧楀箖閵忋倕绀傞柣鎾崇岸閸嬫挾绱掑Ο璇插伎濠德板€愰崑鎾翠繆椤愶絿鎳囬挊鐔兼煥濠靛棭妲归柣鎾跺枛閺岋綁寮幐搴㈠枑闂佹椿鍘奸鍡欐崲濠靛顫呴柍钘夋嚀閳ь剙娼￠弻鐔碱敊閸濆嫬濮﹂梺璇″枓閸撴繈骞嗛弮鍫晩闁稿繒鈷堥崥娆撴⒒閸屾瑧鍔嶉柣顏勭秺瀹曡绻濆锝傚亾閿曞倸閱囬柕澶涘閸樻垿姊洪幖鐐插姶闁告挻宀搁幃锟犳偄閸忚偐鍘搁梺绋挎湰缁嬫垿顢氬鍫熺厱闁绘柨鎼禒锕傛煏閸パ冾伃鐎殿噮鍓涢幑鍕Ω閹板苯瀚崣蹇撯攽閻樺弶鍣烘い蹇曞У缁绘盯骞嬮悩铏瘓閻庤娲︽禍婵嬪箯閸涙潙宸濆┑鐘插濞堝爼姊婚崒姘偓椋庢濮橆剦鐒介柤濮愬€楃粈濠囨煕閳╁啰鈽夐柛銊ュ€块弻娑㈠箛椤掆偓濡﹢鏌ㄥ┑鍡╂Ц缂佺姵绋掗妵鍕箣閿濆憛鎾绘煟鎼粹槅鐓兼慨濠呮閹叉挳宕熼銏犘戠紓浣稿⒔閾忓酣宕㈡禒瀣ㄢ偓鍐Ψ閳轰胶鍊炲銈嗗笂鐠佹煡骞忓ú顏呪拻闁稿本姘ㄦ晶娑樸€掑顓ф當閸楅亶鏌涢锝嗙闁绘挻娲熼弻锟犲磼濠靛棗濮烽柣搴㈢煯閸楁娊寮诲鍥╃＜婵☆垵顕ч棄宥夋煟鎼存繄绁烽柛瀣姍閸┾偓妞ゆ帒鍊归弳鈺傘亜椤撶偟澧ｉ柕鍥ㄥ姍瀹曠喖顢涘☉鎺撳闂備胶顢婇崑鎰板磻濞戙垹绀夐柕澶涘缁犳儳顭跨捄渚剳闁愁垱娲滅槐鎺楀磼濮樻瘷褔鏌熼鐣屾噰闁诡喗绮岃灒闁绘挸楠哥粻鐐测攽閻樺灚鏆╅柛瀣☉铻炴俊銈呭暞瀹曞弶鎱ㄥ璇蹭壕閻庤娲╃紞浣哥暦閻旂⒈鏁嶆繛鎴炶壘楠炴劕鈹戦悙鑸靛涧缂佽弓绮欓獮妤€顭ㄩ崱妞诲亾閺夋垟鏀介柣鎰▕閸ょ喎鈹戦姘煎殶缂侇喖顭烽獮妯兼嫚閼碱剛鏋冮梻浣告惈缁嬩線宕㈡總鍛婂亗婵炴垯鍨洪悡鏇㈡煙閼割剙濡芥繛鍛嚇閺岋紕鈧綆鍋呭畷灞炬叏婵犲偆鐓肩€规洘甯掗埢搴ㄥ箣椤撶啘婊堟⒒娴ｄ警鏀版い鏇熺矌閹广垹鈹戠€ｎ亞鐣洪梺缁樺灩閻℃棃寮澶嬬厽闁归偊鍘肩徊濠氭煟鎼搭喖寮柟顔筋殘閹叉挳宕熼鍌ゆК婵犵數鍋犻婊呯不閹剧粯鏅查柣鎰惈閸楁娊鏌ｉ弮鍌滅瘈缂併劌顭峰Λ鍛搭敃閵忊€愁槱闂佸湱顭堥…宄扮暦閹惰姤鎯為柛锔诲幘閿涙繈鎮楅獮鍨姎闁瑰啿绻樺畷鏉款潨閳ь剟寮婚垾宕囨殕闁逞屽墴瀹曚即寮介鐘茬ウ闂佸搫绋侀崣搴ㄥ极閸ヮ剚鐓熼柟閭﹀墮閹線鏌涢弽銊у⒈缂佽鲸鎹囧畷鎺戔枎閹烘繂鏁奸梻?
   */
  async getReadOnlySnapshot(packageId: number, monthNo: number, user: RequestUserScope) {
    const pkg = await this.findPackageOrThrow(packageId);
    this.verifyCityOwnership(pkg, user);

    const snapshot = await this.snapshotRepo.findOne({
      where: { packageId, belongMonth: monthNo },
    });

    if (!snapshot) {
      return {
        packageId,
        monthNo,
        isSubmitted: false,
        snapshot: null,
      };
    }

    return {
      packageId,
      monthNo,
      isSubmitted: true,
      snapshot: {
        summary: snapshot.summaryJson,
        contractRows: snapshot.contractRowsJson,
        costRows: snapshot.costRowsJson,
        maintenanceRows: snapshot.maintenanceRowsJson,
        submittedAt: snapshot.actualSubmittedAt,
        isOverdue: snapshot.isOverdue === 1,
      },
    };
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞闁靛ě鍛獎闂備礁澹婇崑鍛村箚婵犲倵妲堥柕蹇曞Х椤︽澘顪冮妶鍡欏ⅳ闁稿鎹囬弻娑㈠Ψ椤旂厧顫梺缁樺笩閸嬫劙鍩€椤掆偓缁犲秹宕曢幍顔藉闁哄被鍎辩壕濠氭煙閸撗呭笡闁哄懏绻堥弻娑氫沪閹冩懙闂佸摜鍋涢悥鐓庮潖閾忓湱纾兼俊顖涙た濮婂潡姊洪棃娑欘棏闁稿鎹囧铏规偘閳ュ厖澹曢梻浣告啞閸旀牜绮婇幘顔肩哗濞寸姴顑嗛悡鐔镐繆椤栨繂浜归悽顖涚⊕缁绘盯骞婂畡鏉款仹缂佽妫欓妵鍕箛閸撲焦鍋у┑鐐村絻閻°劑銆冮妷鈺傚€烽柟纰卞幗閻や線姊虹拠鈥虫灀闁哄懏绻勫Σ鎰板箳閹冲磭鍠栭幃鈩冩償閳╁啳绶㈠┑鐘垫暩婵兘寮幖浣哥；闁绘劕鎼崹鍌炴煙椤栨粌顣奸柟鍐茬灱缁辨捇宕掑▎鎴М婵犫拃鍐弰鐎规洖缍婂璺侯煶閻庢挤 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箻閺屸剝寰勭€ｎ亝顔呴悷婊呭鐢帞澹曟總鍛婄厽闁归偊鍘肩徊濠氭煕鐎ｎ亞效婵﹥妞介獮鍡氼槾缂佺姷澧楃换婵嬪焵椤掍焦缍囬柕濞р偓閺嬫牠鎮楅獮鍨姎妞わ缚鍗抽幃锟犳偄閸忚偐鍘搁梺绋挎湰濮樸劍绂掗姀銈嗙厵妞ゆ棁妫勯悘鎾煛瀹€瀣瘈鐎规洦浜濋幏鍛矙濞嗙偓楠勯梻鍌欑窔閳ь剛鍋涢懟顖涙櫠椤曗偓閺屾稑螣閼姐倗鐓夐悗瑙勬礃閸ㄥ潡鐛Ο鑲╃＜婵☆垳鍘х敮妤呮煟閻斿摜鐭嬬紒顔芥尭閻ｅ嘲顭ㄩ崘锝嗙€婚梺瑙勫劤閻°劌鈻嶉崶顒佲拺闂傚牊绋撶粻鐐烘煕婵犲啯绀嬮柟顔斤耿楠炲酣鎳為妷褍骞嶅┑鈽嗗亰椤ｏ箓鎳楅崼鏇炵鐎广儱妫旂换鍡樹繆閻愰潧甯跺┑顔煎€归幈銊︾節閸愨斂浠㈠Δ鐘靛仦閸旀牠骞嗛弮鍫熸櫜闁搞儮鏅滃▓濂告⒒閸屾瑨鍏岄柟铏崌瀹曨垶宕稿Δ浣哄帎闂佹寧绻傞幏瀣吹閺囥垺鐓涢悘鐐额嚙閸旀氨绱掗悩鍨殌闂囧鏌ㄥ┑鍡樺櫤闁规彃鎲￠妵鍕籍閳ь剟宕濆▎鎾宠摕闁挎繂妫欓崕鐔兼煏韫囧﹥鍣板┑顔兼喘閺岋箓宕橀缁樺枤闂佸搫鐬奸崰鏍€佸☉姗嗘僵闁告鍋愰崣锛勭磽?
   *
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋涢ˇ鐢稿极閹剧粯鍋愰柛鎰级閻ゅ嫬鈹戞幊閸娧呭緤娴犲鐤い鏍仜绾惧鎮楅敐搴℃灍闁绘挻娲熼弻宥夊煛娴ｅ憡娈堕梺瀹犳椤﹁京妲愰幒妤佸亹鐎规洖娲ら埛宀勬⒑閸濆嫮鐏遍柛鐘崇墵閻涱噣骞嬮敃鈧粻娑欍亜閹烘垵鈧摜鏁崸妤佲拻濞达絼璀﹂悞鐐亜閹存繃顥㈤柡浣稿暣婵偓闁靛牆鎳愰悾鍝勨攽椤斿浠滈柛瀣崌閺岀喖顢欓悾灞惧櫚闂佽鍠曠划娆忕暦瑜版帩鏁冮柨婵嗘噺濞呯喐绻濋悽闈浶ユい锝勭矙瀹曟粌鈹戠€ｎ偄浜楅梺鏂ユ櫅閸熶即銆呴弻銉︾厱妞ゆ劧绲剧粈鈧梺钘夊暟閸犳牠寮婚妸銉㈡斀闁糕檧鏅滄晥闂備胶顭堥敃锕傚礂濮椻偓瀵鈽夊Ο閿嬬€婚棅顐㈡祫缁查箖顢撻崱娆戠＝濞达綁顥撻埞鎺楁煕閺傛寧鎹ｆ俊?
   * - 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亜顒㈡い鎰矙閺屻劑鎮㈤崫鍕戙垻鐥幆褜鐓奸柡灞剧☉閳藉宕￠悙瀵镐壕闂備礁纾幊鎾剁矓瑜版帒钃熺憸鎴犵不濞戞﹩娼╅柛蹇氬亹缁夌兘鏌?contractId 婵?contracts 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煟閵忋埄鐒剧痪鎯ь煼閺岋綁骞囬鑺ユ瘎闂佹椿鍘介悷鈺呮偂椤愶箑鐐婇柕濞р偓濡插牏绱撴担鎻掍壕婵犮垼娉涙径鍥磻閹捐崵宓侀柛顭戝枛婵骸顪冮妶蹇曠窗闁告鍟块悾鐑藉箣閿曗偓绾惧ジ鏌ｉ幇顒夊殶闁告瑥妫楅埞鎴︽倷閺夋垹浠搁梺鎸庣閵囧嫯绠涢敐鍕仐闂佽鍠楅〃鍛达綖濠靛鏁囬柣鎰级閹虫瑩姊绘担鍛婃儓闁哄牜鍓欑叅婵犻潧鐗忔稉宥嗙箾閹寸偛鐒归柛瀣崌閺佹劖鎯斿┑鍫熸櫦濠电偛顕繛鈧紒鐘崇墪椤繘鎼归悷鏉款嚙闂佸搫娲ㄩ崰鎰版偟閺冨牊鈷戠紒瀣皡瀹搞儲绻涚涵椋庣瘈闁绘侗鍣ｅ畷姗€濡告惔銏☆棃鐎规洏鍔戦、姗€鎮㈡搴涘仩婵犵绱曢崑鎴﹀磹閺嶎厼绠板Δ锝呭暙绾剧粯鎱ㄥ璇蹭壕濡ょ姷鍋涢鍛存偩閿熺姴绠ラ柧蹇ｅ亝閺?contractCode 闂?contractName
   * - 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊椤掑鏅悷婊冪箻楠炴垿濮€閵堝懐鐤€濡炪倖妫佸Λ鍕償婵犲洦鈷戠憸鐗堝笒娴滀即鏌涙惔銊︽锭闁宠棄顦灒婵犲﹤瀚ˉ鍫⑩偓瑙勬磸閸旀垿銆佸鈧幃鈺呮濞戞鐣遍梻鍌氬€搁崐鐑芥嚄閸撲礁鍨濇い鏍仜缁€澶愭煥閺囩偛鈧摜绮堥崼鐔稿弿婵妫楅獮鏍煕閵婏附顥堥柟顔筋殔閳藉鈻庡Ο鐓庡Ш缂傚倷璁插褔宕戦幘鏂ユ斀闁绘ê鐏氶弳鈺呮煕鐎ｎ剙浠辩€规洘娲熼幖褰掝敃閵堝孩閿ゅ┑掳鍊х徊浠嬪疮椤栫偞鍋傞柣鏂垮悑閻撶喐淇婇姘儓闁哄棗宕埞鎴︻敊绾拌鲸鈻堥梺鍝勬湰閻╊垶骞冮埡鍛優妞ゆ劑鍊ゅΣ鍓佺磽閸屾瑧璐伴柛鐘崇洴椤㈡俺顦归柛鈹垮劜瀵板嫰骞囬澶嬬秱闂備礁鍟块幖顐﹀磹閻熸壋鏋嶉柛銉墯閳锋帒銆掑锝呬壕濠电偘鍖犻崶銊ヤ罕闂佺硶鍓濈粙鎴犵不閻樿绠归弶鍫濆⒔瀹€娑㈡煕鐎ｎ偅灏柍钘夘槸閻ｇ兘宕堕埞顒佺矒濮婃椽宕崟顓犲姽缂備焦鐓＄粻鏍嵁閸℃稑绫嶉柛顐ｇ箥濞煎﹪姊洪崘鑼邯闁哄懏鐩敐鐐茬暆閸曨兘鎷绘繛杈剧悼閹虫捇顢氬鍛亾閸忓浜鹃梺褰掓？缁€渚€鎷?contract_code_snapshot / contract_name_snapshot
   * - 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸ゅ嫰鏌涢锝嗙闁诡垳鍋ら獮鏍庨鈧俊濂告煟椤撶噥娈滄鐐寸墪鑿愭い鎺嗗亾濠德ゅ亹缁辨帡骞囬褎鐤侀梺鍝勭焿缁绘繂鐣烽崼鏇炵厸濞达絽娴勭徊鍧楀焵椤掑喚娼愭繛鍙夌墪椤曪綁宕奸弴鐐电杽闂侀潧顭堥崕娆撴偄閻撳海顔囬柟鑹版彧缁插鍩€椤掍礁濮夌紒杈ㄥ笧缁辨帡濮€閻樿尙顔囬梻浣侯焾椤戝棝骞戦崶褜娼栫紓浣股戞刊鏉戙€掑鐓庣仯闁告柨鎽滅槐鎾存媴閾忕懓绗￠梺鍛婃⒐閻熲晠鎮伴鐣岀瘈闁告劏鏅涢崝鍛存⒑闂堟侗鐒鹃柛搴㈠▕瀹曘垹煤椤忓拋妫呭銈嗗姂閸ㄧ儤寰勯崟顓犵＜閻庯綆鍋勫ù顕€鏌熼鍡欑瘈鐎殿喗鎸抽幃銏㈢矙閸喕绱熷┑鐘愁問閸犳銆冮崨顓囨稑螖娴ｈ鐝峰銈嗙墱閸嬬偤鎮″▎鎾寸厽鐟滃秹骞楀鍛煋妞ゆ洍鍋撻柡灞糕偓宕囨殕閻庯綆鍓涜ⅵ濠电姵顔栭崰鎺楀磻閹剧粯鈷戠紓浣诡焽閹插潡鏌涚€ｎ偅宕岄柡宀嬬秮楠炴﹢鎮锋０浣圭潖闂備線鈧偛鑻晶鍙夈亜椤愩埄妲搁悡銈夌叓閸ャ劎鈽夌痪鎯ф健濮婂宕奸悢鎭掆偓鎺楁煛閸☆厾鐣甸柡宀嬬秮楠炴ê鐣烽崶褍鎽甸梻浣姐€€閸嬫挸霉閻樺樊鍎愰柣鎾存礋閺屾洘寰勭€ｎ亞浜堕梺绋款儐閹瑰洭寮诲☉姘ｅ亾閿濆骸浜濈€规洖鐭傞弻锛勪沪閼恒儺妫炲銈嗘尭閵堢鐣烽崡鐑嗘富闁诡垎鍕暉濠电姷鏁告慨鐢割敊閺嶎厼绐楁俊銈呮噳閳ь剨绠撳畷鍫曨敆閳ь剟宕掗妸褎鍠愰幖杈剧悼閻鈧箍鍎遍幉姗€寮崼婵嗙獩濡炪倖姊归崕鎶界嵁瀹ュ應鏀介柣鎰摠鐏忎即鏌よぐ鎺旂暫闁诡喗锚閳规垿宕堕妸銉ヤ紟闂備胶顭堥張顒佺珶閺囥垹纾?闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋涢ˇ鐢稿极瀹ュ绀嬫い鎺嶇劍椤斿洭姊绘担铏瑰笡闁告梹娲熼、姘额敇閻樺吀绗夋俊銈忕到閸燁垶鎮￠崘顏呭枑婵犲﹤鐗嗙粈鍫熸叏濡潡鍝虹€规洖寮剁换娑㈠箣濞嗗繒浠奸悗鐟版啞缁诲啴濡甸崟顖氱闁告鍋熸禒濂告倵濞堝灝鏋欓柛妤€鍟块～蹇涙倻濡顫￠梺瑙勵問閸ｎ喖危椤斿墽纾藉ù锝呭濡插ジ鏌涢埡鍌滃⒈缂侇喖顑夐獮鎺懳旀担瑙勭彇闂備胶顭堥張顒傜矙閹达附鍎岄柛鏇ㄥ墰缁♀偓闂侀潧楠忕徊鍓ф兜妤ｅ啯鐓ラ柡鍥崝銈囩磼鏉堚晛浠︾€垫澘瀚伴獮鍥敇濞戞瑥顏烘繝鐢靛仩閹活亞寰婃禒瀣疅闁跨喓濮撮悿顕€鏌ｉ幇顔煎妺闁绘挾鍠栭弻锝夊即閻愭祴鍋撴繝姘仼闁规儼濮ら悡蹇涙煕閵夛絽濡煎┑顔肩Ф閳ь剝顫夊ú姗€鏁冮姀銈冣偓浣糕枎閹炬潙娈熼梺闈涱檧婵″洩銇愰幖浣光拻闁稿本鐟ㄩ崗宀€绱掗鍛仸鐎规洘绻堝鎾閻樻鍟囨俊鐐€栭崝鎴﹀磹濡や胶鈻旂€广儱妫庢禍婊堟煛閸ヮ煈娈斿ù婊堢畺濮婃椽宕崟顒佹嫳濠电偛寮堕敋妞ゆ洏鍎靛畷鐔碱敃閻斿壊娼旈梻渚€娼х换鍡椢ｉ崨鏉戠劦妞ゆ巻鍋撶紒澶嬫尦閸╃偤骞嬮敂钘夆偓鐑芥煠绾板崬澧い锝嗘そ濮婅櫣绱掑Ο鐓庘吂闂侀潧鐗忛…鍫ヮ敋閿濆棛绡€婵﹩鍘兼禍婊堟⒑缂佹ê鐏﹂柨姘舵煟濠靛懎宓嗘慨濠冩そ閹瑩鎸婃径濠傂撴繝鐢靛仜閹冲繐煤閻旂厧绠栨慨妞诲亾鐎规洖宕埢搴ㄥ箣閻欏懐闂繝鐢靛仩閹活亞绱為埀顒併亜閺囩喓澧柍缁樻崌瀵噣鍩€椤掑嫬桅闁告洦鍨遍弲婵嬫煕鐏炲墽鈯曢梺娆惧弮濮婄儤瀵煎▎鎴炲仹闂佺绻戦敃銏狀嚕椤愶箑绠涢柡澶婄仢缁愭盯姊虹粙鎸庢拱缂佸甯¤棢闁割偁鍎查悡鏇㈡煃鐟欏嫬鍔ゅù婊呭亾娣囧﹪鎮欓鍕ㄥ亾閺嶎偅鏆滃┑鐘叉处閸ゅ嫰鏌涢锝嗙闁抽攱妫冮弻娑㈠即閵娿儳浠梺缁樻尰缁嬫捇鍩€椤掆偓缁犲秹宕曟潏顭戞闁归棿鑳跺畵渚€鏌″搴ｄ汗?
   */
  async draftSave(packageId: number, dto: DraftSaveRequest, user: RequestUserScope) {
    const pkg = await this.findPackageOrThrow(packageId);
    this.verifyCityOwnership(pkg, user);

    // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴濐潟閳ь剙鍊块幐濠冪珶閳哄绉€规洏鍔戝鍫曞箣閻欏懐骞㈤梻鍌欑窔閳ь剛鍋涢懟顖涙櫠閹绢喗鐓涢悘鐐插⒔閵嗘帡鏌嶈閸撱劎绱為崱娑樼；闁告侗鍘鹃弳锔锯偓鍏夊亾闁告洦鍓涢崢鎼佹倵閸忓浜鹃柣搴秵閸撴盯鏁嶉悢鍝ョ閻庣數顭堥鎾斥攽閳ヨ櫕鍠樻鐐茬箻閹晝鎷犻懠顒夊斀闂備礁婀遍崕銈夊春閸繍鐒芥繛鎴炴皑绾句粙鏌涚仦鎹愬闁逞屽墯閹倸鐣烽幇鏉夸紶闁靛／鍛帬闂備礁婀遍搹搴ㄥ闯椤曗偓瀵偊宕熼顐ゅ數闁荤姾妗ㄧ拃锕傛偂椤掑嫭鐓曢柕鍫濇缁€瀣煛瀹€瀣М濠殿喒鍋撻梺闈涚箚閺呮繈宕濋幖浣光拻濞达絿顭堥懜瑙勭箾瀹割喖寮€殿喖顭烽弫鎰緞婵犲嫮娼夐梻渚€鈧偛鑻晶瀵糕偓瑙勬礃缁诲牆鐣烽妸褉鍋撳☉娅虫垵鈻嶉崶顒佲拺缂佸瀵у﹢鎵磼鐎ｎ偅宕岀€规洏鍨藉畷锟犳倷閳哄倹鏉告俊鐐€栧濠氭偂椤愶富鏁傞柛娑卞枟閻濋攱绻涚€电孝妞ゆ垵妫濆畷鎴﹀煛閸涱喒鎷哄銈嗗坊閸嬫挾绱掓径灞炬毈闁诡噯绻濆鎾閿涘嫬骞嶉梻浣告贡閳峰牓宕㈡總鍛婂€堕柨婵嗘川绾惧ジ鏌嶉柨顖氫壕闂佺顑嗛幐缁樼┍婵犲洤围闁搞儺鐏濋妷鈺傜厱閻庯綆鍓欐禒杈殽閻愭潙鐏寸€规洖鐖奸、妤呭磼濮樹究鍋婇梻鍌欑劍閹爼宕曞ú顏勭闁挎洖鍊搁弸渚€鏌涘畝鈧崑鐐烘偂閺囩喓绠鹃柟瀛樼箓閼歌顨ラ悙鎼疁闁哄备鍓濈粭鐔煎炊閿斿墽娉块梻浣哥枃椤宕归崸妤€绠栨繛鍡樻尭缁狙囨煙鐎电小婵℃鎹囧缁樻媴缁涘缍堥梺鐑╁墲濞茬喖銆佸鎰佹▌闂佹寧绻勯崑鐘电不濞戞ǚ妲堟繛鍡楃箣閻㈠姊绘担鍝ョШ闁衡偓閸楃儐娼栫憸鐗堝笚閸庡孩銇勯弽銊р棩缂佽妫濋弻銈夊箹娴ｈ閿紓浣稿閸嬫盯鍩為幋锔藉亹闁圭粯宸婚崑鎾诲及韫囧姹楁繝銏ｆ硾鑹岄柡鈧禒瀣厽婵妫楅弸娑㈡煟韫囨岸鍝虹紒缁樼⊕瀵板嫮鈧綆鍓氶崚娑橆渻閵堝啫鐏柣妤冨Т閻ｇ兘宕￠悜鍡樺瘜缂傚倷鐒﹂…鍥焵椤掍焦銇濇俊顐㈡嚇椤㈡洟濮€閳ユ剚妲辩紓鍌欑椤戝棛鏁垾宕囨殾闁硅揪绠戦悞娲煕閹板吀绨芥い鏃€娲熷铏瑰寲閺囩偛鈷夊銈庡幖濞差參鐛繝鍥у窛妞ゆ牗绮庨敍婊勭節閵忥絽鐓愰柨姘箾閸涱厾效闁哄备鈧磭鏆嗛悗锝庡墰閻﹀牓姊虹化鏇熸澒闁稿鎸搁—鍐Χ閸℃鐟ㄩ柣搴㈠嚬閸欏啫顕ｉ弻銉ョ闁圭儤绻勯崬鐢告煟閻樼儤顏犻悘蹇嬪姂瀹曟繈鎮㈤幖鐐扮盎闂佸搫鍊哥亸鍛寸叕椤掍焦鍙忓┑鐘插暞閵囨繄鈧娲樼划鎾荤嵁閹捐绠崇€广儱娲﹂弲濂告⒒閸屾瑧顦﹂柟鑺ョ矋閹便劑鎮界粙璺槷濠德板€曢崯顖烇綖閺囥垺鐓熼柟閭﹀墯閹牓鏌?
    const existingSnapshot = await this.snapshotRepo.findOne({
      where: { packageId, belongMonth: dto.monthNo },
    });
    if (existingSnapshot) {
      const activeGrant = await this.unlockGrantRepo.findOne({
        where: { packageId, monthNo: dto.monthNo, expiresAt: MoreThan(new Date()) },
      });
      if (!activeGrant) {
        throw new BadRequestException('This month is already submitted. Please contact an admin to unlock it.');
      }
    }

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞妞ゆ巻鍋撴潻婵嬫⒑闁偛鑻晶鎾煛鐏炲墽銆掗柍褜鍓ㄧ紞鍡涘磻閸涱厾鏆︾€光偓閸曨剛鍘搁柣蹇曞仜婢ц棄煤鐎涙ǜ浜滈柕蹇婂墲缁€瀣煛娴ｇ懓濮嶇€规洖宕埢搴∥熼幁宥囧仱濮婂宕掑▎鎰偘婵犮垻鎳撻悧蹇旂缁嬪簱鏋庨柟閭﹀枤椤旀洟姊洪柅鐐茶嫰婢ф挳鏌＄仦绯曞亾瀹曞洦娈曢梺閫炲苯澧寸€规洑鍗抽獮妯兼嫚閼碱剛宕跺┑鐘垫暩婵瓨瀵奸敐澶嬪亜闁告稑锕ら～锟犳⒑閸濆嫷妲规い鎴炵懃铻炴繝濠傜墛閳锋帡鏌涚仦鎹愬闁逞屽墴椤ユ挾鍒掗崼鐔虹懝闁逞屽墴閻涱噣寮介褎鏅濋梺鎸庢濡嫭绂嶉柆宥嗏拺缂侇垱娲栨晶鏌ユ煣閺傛鍎旂€规洖鐖奸、妤佸緞鐎ｎ偅鐝梻鍌欒兌缁垶宕濆Ο闂寸剨婵炲棙鎸婚崑鈺傜箾瀹割喕绨奸柣鎾寸懇閺屾稖绠涘顑挎睏闂佸搫妫欓敃銏ゅ蓟濞戙垹妫橀悹鎭掑妿娴煎洭姊?ID闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弮鍫熸殰闁稿鎸剧划顓炩槈濡娅ч梺娲诲幗閻熲晠寮婚悢鍛婄秶闁告挆鍛闂佽瀛╅懝楣兯囨导鏉懳﹂柛鏇ㄥ灠缁犲磭鈧箍鍎遍悧鍡涘储閿熺姵鈷戠紓浣诡焽缁犳捇鏌ｉ弽褋鍋㈢€殿喖顭烽幃銏ゅ礂閻撳簶鍋撶紒妯诲弿婵°倐鍋撴俊顐ｇ懇閹箖鎮滈懞銉㈡嫼缂傚倷鐒﹁摫閻忓浚鍙冮弻娑欑節閸屾稑浠撮梺璇″櫙缁绘繈銆侀弴銏℃櫇闁逞屽墴閹瑦绻濋崶銊у帾婵犵數濮寸换妤呭触閸岀偞鐓欑€瑰嫰鍋婇悡鍏兼叏婵犲啯銇濈€规洏鍔嶇换婵嬪礋椤掆偓閺嬶箓姊绘担渚劸妞ゆ垵妫濋獮鎴﹀炊瑜滃鏍ㄧ箾瀹割喕绨奸柛銈嗗浮閺屾洟宕煎┑鍥ф櫧闂侀潧楠忕槐鏇犵不妤ｅ啯鍊堕柣鎰絻閳ь剚鎮傞幃姗€鎳犻钘変壕閻熸瑥瀚粈鍫熴亜閵忕媴韬┑锛勬暬楠炲洭寮剁捄顭戝敽闂備胶鎳撻顓熸叏閻戣棄姹叉い鎰堕檮閳锋垿鏌ｉ悢鍛婄凡闁诡喗鍨块弻锝夋晲鎼存繈鍋楅悗瑙勬礃缁诲倿鎮惧┑瀣劦妞ゆ帒瀚粻鐔兼煙缂併垹鏋熼柡鍛箞閺屾稓浠﹂崜褉妲堥梺閫炲苯澧柣鏍с偢瀵鏁愭径濠勭杸濡炪倖姊婚崢褎淇婂ú顏呪拺闁圭娴烽妴鎺楁煕閻樿櫕灏垫俊鍙夊姍楠炴帡寮埀顒傗偓姘哺閺屾稑鈻庤箛锝嗏枔濠碘槅鍋撶粻鎾愁潖濞差亜浼犻柛鏇ㄥ幘娴煎洭姊洪崫銉バｉ柣妤冨█婵″瓨鎷呴懖婵堝枎閳诲酣鎮欓顐熸櫊濮婄粯鎷呯粵瀣缂備胶绮〃鍫熺缁嬪簱鏋庨柟瀵稿剱濞肩喖姊洪崷顓炲妺闁规瓕宕电槐鐐哄炊椤掍胶鍘繝鐢靛€崘顭戜患濠电偛鎳忛崹鍨潖缂佹ɑ濯撮柛婵勫劵缁辩偟绱撴笟鍥ф珮闁搞劍濯介悘瀣⒑閸涘﹤濮€闁哄懏鐟ч幑銏ゅ幢濞戞瑧鍘甸梻鍌氬€搁顓㈠礉瀹ュ鐓涢柛娑卞枤缁犵偤鏌＄仦鐣屝ユい褌绶氶弻娑㈠箻鐎涙娈ょ紓? DTO 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧鏌ｉ幇顒佹儓闁搞劌鍊块弻娑㈩敃閿濆棛顦ョ紓浣哄Т缂嶅﹪寮诲澶婁紶闁告洦鍓欏▍锝夋⒑缁嬭儻顫﹂柛鏃€鍨垮濠氭偄绾拌鲸鏅梺绯曗偓宕囩濞存粓绠栧?contractId 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴姘辩Т闂佹悶鍎洪崜锕傚极閸ヮ剚鐓忛煫鍥ㄦ礀鍟搁梺鎸庣〒閸犳牕顫忓ú顏勬嵍妞ゆ挴鍓濋妤呮⒑閸濄儱校闁绘濮撮悾?JSON 闂?string闂?
    const rawContractIds = (dto.contractRows || []).map((r) => r.contractId).filter(Boolean);
    const contractIds = rawContractIds.map((id) => Number(id));
    const contractsMap = new Map<number, ContractEntity>();
    if (contractIds.length > 0) {
      const contracts = await this.contractRepo.find({
        where: { id: In(contractIds) },
      });
      for (const c of contracts) {
        contractsMap.set(c.id, c);
      }
    }

    // 1. Upsert 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋涢ˇ鐢稿极閹剧粯鍋愰柛鎰级閻ゅ嫬鈹戞幊閸娧呭緤娴犲鐤い鏍仜绾惧鎮楅敐搴℃灍闁绘挻娲熼弻宥夊煛娴ｅ憡娈堕梺瀹犳椤﹁京妲愰幒妤佸亹鐎规洖娲ら埛宀勬⒑閸濆嫮鐏遍柛鐘崇墵閻涱噣骞嬮敃鈧粻娑欍亜閹烘垵鈧摜鏁崸妤佲拻濞达絼璀﹂悞鐐亜閹存繃顥㈤柍銉畵瀹曞爼顢楅埀顒勬倿閸偁浜滈柟鍝勬娴滈箖姊洪崨濞氭垹鍒掗幘宕囨殾闁硅揪绠戠粻鑽ょ磽娴ｅ顏堝焵椤掑倹鏆柡灞诲妼閳规垿宕卞☉鎵佸亾濡も偓椤儻顦村褎顨婃俊鐢稿礋椤栨稒娅嗛柣鐔哥懃鐎氼參鎮靛顑芥斀妞ゆ梻銆嬪銉╂煙绾板崬浜為柛娆忔噽缁辨捇宕掑▎鎴濆闂佹寧宀搁弻宥囨嫚閼碱剛顔掑┑顔硷攻濡炶棄鐣烽妸锔剧瘈闁告劦浜滃鍐测攽鎺抽崐妤佹叏閻㈢绠栭柛宀€鍋涢弸渚€鏌涢幇闈涙灈妞ゎ偄鎳橀弻鏇㈠醇濠靛浂妫″┑鐐叉噺閻楃姴顫忓ú顏勫窛濠电姴鍟伴敍姗€姊洪崨濠冪叆闁哄牜鍓涚划瀣吋閸℃劕浜濋梺鍛婂姀閺呮繈宕㈤柆宥嗏拺闁圭瀛╅ˉ鍡樸亜閺囧棗娲ㄥ畵渚€鏌″搴ｄ汗鐟滅増甯楅崑鎰偓瑙勬礀濞层劑鎮℃径鎰拺闁告繂瀚悘閬嶆煕閻樺磭澧甸柕鍡曠閳诲酣骞囬鈧顔剧磽娴ｅ壊鍎忛柣蹇旂箞瀹曪絾绻濋崶銊у幗?code/name 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸ゅ嫰鏌涢锝嗙５闁逞屽墾缁犳挸鐣锋總绋课ㄦい鏃囧Г濞呭牓姊绘担铏广€婇柛鎾寸箘缁瑩骞掑Δ鈧崥褰掓倶閻愯泛鈻忛柡鍐ㄧ墛閺呮煡鏌涘☉鍗炲箺婵炲牜鍘剧槐鎾存媴閸濆嫅銉╂煛娴ｅ壊鐓肩€殿喛顕ч鍏煎緞婵犱胶鐐婇梻浣告啞濞诧箓宕滃▎蹇婃瀺闁靛牆顦伴埛鎴犵磼鐎ｎ偒鍎ラ柛搴＄箻閺屾稒绻濋崒銈囧悑濡ょ姷鍋涢ˇ杈╁垝濞嗘劖鍎熼柟鎯х摠閺夋悂姊绘担绋款棌闁稿妫濆畷鎶藉Ψ閵夘喚鍔?
    for (const row of dto.contractRows || []) {
      const contract = contractsMap.get(Number(row.contractId));

      if (!contract) {
        throw new BadRequestException(
          'Contract #' + row.contractId + ' not found or deleted',
        );
      }

      const codeSnapshot = contract.contractCode;
      const nameSnapshot = contract.contractName;

      const existing = await this.contractRowRepo.findOne({
        where: {
          packageId,
          contractCodeSnapshot: codeSnapshot,
          monthNo: dto.monthNo,
        },
      });

      if (existing) {
        existing.completionAmount = row.completionAmount;
        existing.acceptanceAmount = row.acceptanceAmount;
        existing.invoiceAmount = row.invoiceAmount ?? 0;
        existing.orderAmount = row.orderAmount ?? 0;
        await this.contractRowRepo.save(existing);
      } else {
        await this.contractRowRepo.save(
          this.contractRowRepo.create({
            packageId,
            contractId: row.contractId,
            contractCodeSnapshot: codeSnapshot,
            contractNameSnapshot: nameSnapshot,
            monthNo: dto.monthNo,
            completionAmount: row.completionAmount,
            acceptanceAmount: row.acceptanceAmount,
            invoiceAmount: row.invoiceAmount ?? 0,
            orderAmount: row.orderAmount ?? 0,
            isLocked: 0,
          }),
        );
      }
    }

    // 2. Upsert 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箻閺岋綁濮€閵忊晝鍔哥紓浣插亾濠㈣埖鍔栭悡娑㈡煕閵夈垺娅呴柛鎾村▕閺屻倝寮堕幐搴′淮濠殿喖锕ュ浠嬨€佸Δ鍛劦妞ゆ帒鍊婚惌鎾绘煙缂併垹鏋涢柛鎴犲Т閵嗘帒顫濋敐鍛闂備礁鎼張顒€煤閻旈鏆﹂柣鎾崇岸閺€浠嬫煕閵夋垵鏈ⅸ闂傚倸鍊烽懗鍫曗€﹂崼銉晞闁糕剝绋堥埀顒婄畵瀹曞爼顢楅埀顒勬倿閸偁浜滈柟鍝勬娴滈箖姊洪崨濞氭垹鍒掗幘宕囨殾闁硅揪绠戠粻鑽ょ磽娴ｅ顏堝焵椤掑倹鏆柡灞诲妼閳规垿宕卞☉鎵佸亾濡も偓椤儻顦村褎顨婃俊鐢稿礋椤栨稒娅嗛柣鐔哥懃鐎氼參鎮靛顑芥斀?costCategoryCode闂?
    for (const row of dto.costRows || []) {
      const existing = await this.costRowRepo.findOne({
        where: {
          packageId,
          monthNo: dto.monthNo,
          costCategoryCode: row.costCategoryCode,
        },
      });

      if (existing) {
        existing.amount = row.amount;
        await this.costRowRepo.save(existing);
      } else {
        await this.costRowRepo.save(
          this.costRowRepo.create({
            packageId,
            monthNo: dto.monthNo,
            costCategoryCode: row.costCategoryCode,
            amount: row.amount,
          }),
        );
      }
    }

    // 3. Upsert 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕閵堝懎顏柡灞剧洴楠炴﹢鎳犻鈧俊浠嬫倵鐟欏嫭绀€鐎殿喖澧庨幑銏犫攽鐎ｎ偒妫冨┑鐐村灦閼归箖路閳ь剟鏌ｆ惔銈庢綈婵炲弶鐗曢锝夊醇閺囩偟鐤勯梺闈涱焾閸庢瑩鎮㈤悡搴ㄦ暅濠德板€愰崑鎾绘煙閻ｅ本鏆慨濠呮缁瑥鈻庨幆褍澹夋俊鐐€ら崢鐓幟洪銏犳槬闁逞屽墯閵囧嫰骞掗崱妞惧闂備礁鎲¤摫缂侇喗鎸搁悾鐑藉箣閿曗偓缁犺崵绱撴担濮戭亪鍩€椤掑倹鏆柡灞诲妼閳规垿宕卞☉鎵佸亾濡も偓椤儻顦村褎顨婃俊鐢稿礋椤栨稒娅嗛柣鐔哥懃鐎氼參鎮靛顑芥斀妞ゆ梻銆嬮弨缁樹繆閻愯埖顥夐柣锝囧厴婵℃悂鏁傞崜褏妲囬梺鐟板悑閻ｎ亪宕规繝姘辈闁挎梻鏅弧鈧梺姹囧灲濞佳勭濠婂應鍋撳▓鍨灈闁绘牕銈稿顐も偓锝庝憾濞撳鏌曢崼婵嬵€楁鐐寸墬缁绘稑顔忛鐓庣睄闂侀潧妫旂粈渚€鍩ユ径鎰潊闁炽儲鏋奸崑鎾绘倻閼恒儱鈧灚绻涢幋鐑嗕紗闁硅揪闄勯崑?
    if (dto.maintenanceRow) {
      const existing = await this.maintenanceRowRepo.findOne({
        where: { packageId, monthNo: dto.monthNo },
      });

      if (existing) {
        Object.assign(existing, {
          invoiceTotalPrevYear: dto.maintenanceRow.invoiceTotalPrevYear || 0,
          invoiceMonthCountPrevYear: dto.maintenanceRow.invoiceMonthCountPrevYear || 0,
          invoiceTotalCurrentYear: dto.maintenanceRow.invoiceTotalCurrentYear || 0,
        });
        await this.maintenanceRowRepo.save(existing);
      } else {
        await this.maintenanceRowRepo.save(
          this.maintenanceRowRepo.create({
            packageId,
            monthNo: dto.monthNo,
            invoiceTotalPrevYear: dto.maintenanceRow.invoiceTotalPrevYear || 0,
            invoiceMonthCountPrevYear: dto.maintenanceRow.invoiceMonthCountPrevYear || 0,
            invoiceTotalCurrentYear: dto.maintenanceRow.invoiceTotalCurrentYear || 0,
          }),
        );
      }
    }

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犵厱婵﹩鍘介妵婵嗏攽闄囬崺鏍ь嚗閸曨厸鍋撻敐搴濈胺婵″弶鍔欏缁樼瑹閳ь剙顭囪婢ф繈姊洪崫鍕櫤闁烩晩鍨堕獮蹇涘箣閿旇棄浜滈柣蹇撶箣閻掞箓寮埀顒勬⒒娴ｈ櫣甯涢柨姘扁偓娈垮枛閻栧ジ鐛弽顓炵疀妞ゆ柨澧介敍婊堟⒑闁偛鑻晶顕€鏌ｉ敐鍡欑疄鐎规洜鍠栭、妤呭磼濮橆剛鐤勬繝鐢靛Х閺佹悂宕戦悙鍝勫瀭闂傚牊绋撻弳锔姐亜閹烘垵顏柛濠傜埣閺屻劑鎮㈤崫鍕戯綁鏌ｉ幘璺烘灈闁哄被鍔岄埞鎴﹀幢閳哄倐銉╂⒑鐟欏嫮鍙€缂佺姵鐗犲濠氬灳瀹曞洦娈曢柣搴秵閸撴盯鎯侀崼銉﹀€甸悷娆忓缁€鍫ユ煕濡姴娴勭紞鏍ㄧ節闂堟侗鍎涢柡浣稿閺屾盯鈥﹂幋婵囩彯濠碘槅鍋呯划鎾愁潖婵犳艾纾兼慨姗嗗厴閸嬫挻顦版惔锝囩劶婵炴挻鍩冮崑鎾搭殽閻愬樊妯€闁轰焦鎹囬幃鈺呭礃閸欏鏉介梻鍌欑閹诧繝骞愰崱娑樺耿婵＄偑鍎崜婵堟崲濠靛顥堟繛鎴炃氶崑鎾寸節濮橈絺鍋撻敃鍌氶唶闁靛浚婢€缁楀姊虹紒妯哄闁稿簺鍊濋幃陇绠涢幘顖涙杸闂佺粯鍔欏褎绂嶉悙顒傜闁告侗鍘介崳鐣岀磼鏉堛劍灏伴柟宄版嚇瀹曪絾寰勭€ｎ剙缍冨┑鐘愁問閸犳牠鏁冮妷銉富濞寸姴顑冮埀顑跨窔瀵挳濮€閳╁啯鐝抽梻浣规偠閸庤崵寰婃ィ鍐╂櫖濠㈣泛鐬肩壕浠嬫煕鐏炲墽鎳勭紒浣哄閵囧嫰寮撮崱妤€鎮╂繛鎴炃氶弨浠嬫倵閿濆簼娴烽柟?
    await this.packageRepo.update(packageId, {
      lastUpdatedBy: user.userId,
      lastUpdatedAt: new Date(),
    });

    return {
      success: true,
      packageId,
      monthNo: dto.monthNo,
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗霉閿濆浜ら柤鏉挎健瀵爼宕煎顓熺彅闂佹悶鍔嶇换鍐Φ閸曨垰鍐€妞ゆ劦婢€缁墎绱撴担鎻掍壕婵犮垼鍩栭崝鏍偂濞嗘挻鐓熼柟瀵镐紳椤忓牊鍊块柣鎰靛墰缁犻箖鎮樿箛鏃傚婵炲懎锕弻锛勪沪鐠囨彃顫囬悗娈垮櫘閸ｏ綁宕洪埀顒併亜閹烘垵顏╅柛鎴犲█閺屻倖鎱ㄩ幇顑藉亾閺嶎叏缍栭柡鍥ュ灪閻撱儲绻濋棃娑欙紞婵℃彃缍婇弻锝夊箻鐎涙顦伴梺鍝勭焿缁绘繂鐣烽崼鏇炍ㄩ柕澶堝労閻庤櫕绻濋悽闈涗粶闁瑰啿绻楅幗顐ょ磽娴ｈ櫣甯涢柣鈺婂灠閻ｅ嘲螖閸涱厾顦х紒鐐妞存悂藟閸儲鈷掑ù锝呮啞閹牓鎮跺鐓庝喊鐎规洘绻傞悾婵嬪礋椤愩倕寮ㄥ┑鐘灱濞夋稖鐧岄梺缁樻煥閸氬宕戦崒鐐茬闁圭⒈鍘奸弸鐔告叏閿濆懏顥犵紒杈ㄦ崌瀹曟帒顫濋钘変壕濡炲瀛╅浠嬫煥閻斿搫孝缂佹劖顨婇弻鈥愁吋鎼粹€崇闂佺粯鎸撮崑鎾绘⒒娴ｇ懓顕滅紒璇插€块獮蹇曗偓锝庡枛閸氬綊鏌￠崶鈺€绱崇憸鐗堝笚閸嬫劗鈧懓澹婇崰鏍礈闁秵鈷戦柛婵嗗閸ｆ椽鏌熼鐓庘偓鍨嚕婵犳碍鏅查柛婊€鐒﹀娲⒑闁偛鑻晶顔姐亜椤撶偞绌挎い锕€缍婇弻?+ 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箳閳ь剝顫夊ú鏍洪敃鍌ゆ晝濞寸姴顑嗛悡蹇涙煕椤愶絿绠栧璺哄閵囧嫰顢曢敐鍡欘槹闂佸搫鐭夌换婵嗙暦閸洖唯闁靛／鍌滄／闂傚倷鑳堕…鍫ヮ敄閸岀偛鐤鹃柣妯款嚙缁犳牜鎲搁悧鍫濈瑨闁绘劕锕弻鏇熺箾瑜嶇€氼參顢欓崟顖涚厽闁绘柨鎽滈惌瀣煛鐏炶濮傞柟顕€绠栭幃婊堟寠婢舵劕鏁归梻浣告惈濞层劑宕愰敐澶婄厸闁告侗鍠氶崢顏堟椤愩垺澶勬繛鍙夌墪閻剙鈹戦悩顔肩伇妞ゎ偄顦叅婵☆垰鍚嬪畷鍙夌箾閹存瑥鐏╃紒鐙欏洦鐓欓悗娑欘焽缁犳牠鏌涙繝搴＄仸婵﹥妞介幊锟犲Χ閸涱喗鐣梻浣告啞娓氭宕归幎鑺ュ€块柛蹇氬亹缁♀偓闂侀潧楠忕徊鍓ф兜妤ｅ啯鍤岄悘鐐插綖缁诲棝鏌熺紒妯虹濠⒀嶇畵閺屸€崇暆閳ь剟宕伴弽顓犲祦闁糕剝鍑瑰Σ楣冩⒑閹稿海鈽夌紒澶婄埣閸┾偓妞ゆ帊鑳堕埊鏇犵磼鐠囪尙澧曟い顐㈢箰鐓ゆい蹇撳缁卞爼姊洪棃娑辨Ф闁稿孩鐓￠幃妤併偅閸愨斁鎷洪梺闈╁瘜閸欏酣鎮為悙顑句簻妞ゆ挾濮撮崢鎾煟濞戝崬娅嶇€规洖宕埥澶娢熼懖鈺傜秮闂傚倷绀佹竟濠囧磻閸涱垱宕查柛鏇ㄥ灱閺佸﹪鏌熼崜褏甯涢柍閿嬪灴閺屾稑鈽夊鍫熸暰婵犮垼娉涚€氫即寮诲☉姗嗘建闁逞屽墰缁寮介渚囨（?
   */
  async submitPreview(packageId: number, dto: DraftSaveRequest, user: RequestUserScope): Promise<SubmitPreviewResponse> {
    const pkg = await this.findPackageOrThrow(packageId);
    this.verifyCityOwnership(pkg, user);

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犖ч柛銉㈡櫇閸橆垶姊绘担鍛婂暈婵炶绠撳畷銏ゆ寠婢跺本娈鹃梺鍛婄懃椤﹁京寮ч埀顒勬⒒閸屾氨澧涘〒姘殜瀹曟洟骞囬悧鍫㈠幈?
    this.validateSubmission(dto);

    // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧鏌ｅΟ娆惧殭缂佺姴鐏氶妵鍕疀閹炬惌妫ょ紓浣插亾濠电姴娲﹂悡鍐喐濠婂牆绀堟慨妯块哺瀹曞弶绻涢幋鐐垫噧缂佸墎鍋ら幃妤呮晲鎼粹€茬敖濡炪倧缂氶崡鎶藉箖濡も偓閳绘捇宕归鐣屽蒋闂備胶顭堥鍛存晝閵夛妇鈹嶅┑鐘叉搐闁卞洭鏌￠崶鈺佷户闁稿﹦鍋ゅ娲礃閸欏鍎撻梺鍝ュУ缁嬫挸危閹版澘钃熼柕澶涜吂閹风粯绻涙潏鍓хК婵炲拑绲块弫顔尖槈閵忥紕鍘搁柣蹇曞仩椤曆勪繆娴犲鐓涢柛娑欐緲閻撴劙鏌熼娑欘棃闁炽儻绠撻獮瀣倷鐎涙褰嗛梻鍌氬€搁崐椋庢閿熺姴绀堟繛鍡樺灩閻捇鏌ｉ姀鐘冲暈闁稿鍊块弻锟犲炊閵夈儳浼勯梺鍛婄懄閹瑰洭寮诲☉銏犖ㄩ柍鍝勶攻椤ユ牠姊洪崨濠傜瑲婵犮垺锕㈤垾锕傛嚄椤栵絾顎囬梻浣告憸婵潧顫濋妸銉庯綁骞囬弶璺唺濠德板€愰崑鎾剁磼閻橆喖鍔氶棁澶愭煥濠靛棙顥滅紒鑼额嚙闇夋繝濠傜墢閻ｆ椽鏌″畝鈧崰鎰版晬閹邦厽濯村〒姘煎灡琚﹀┑鐘垫暩閸嬫盯鎮ч崟顖氱闁瑰瓨绻嶅鏍ㄧ箾瀹割喕绨诲ù鑲╁█閺屾盯寮撮妸銉ヮ潻缂備焦鍔栭惄顖氼潖濞差亜浼犻柕澶堝剾閿濆鐓曢柡鍐ｅ亾闁荤啿鏅犻幃浼搭敋閳ь剙鐣烽崡鐑嗘富缂備焦锕╁鏃堟⒒娓氣偓濞佳呮崲閸℃稑鐒垫い鎺嗗亾闁告ɑ鐗犲畷鐘诲冀瑜夐弨浠嬫煟閹邦剛鎽犻悘蹇庡嵆閺屻倛銇愰幒鏃傛毇闂佽桨绀侀崯鎾极閸岀偛绠氱憸婊兾涘鍫熲拺缂佸妫楃€氬嘲鈻撻弴銏＄厽?
    const summary = await this.calculateBusinessSummary(
      packageId,
      dto.monthNo,
      dto.contractRows,
      dto.costRows,
    );

    return {
      belongMonth: dto.monthNo,
      ...summary,
      isOverdue: this.isMonthOverdue(dto.monthNo),
    };
  }

  /**
   * 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣銏犲閺佸﹪鏌″搴″箹缂佹劖顨嗘穱濠囧Χ閸涱厽娈查悗瑙勬礃閻擄繝寮婚悢鍏肩劷闁挎洍鍋撻柡瀣〒缁辨帡鐓幓鎺嗗亾濠靛钃熼柨婵嗩槹閺呮煡鏌涘☉鍗炴灍闁瑰嘲宕—鍐Χ鎼粹€茬凹濠电偠灏欓崰鏍ь嚕婵犳艾惟闁冲搫鍊告禍婊堟⒑閸涘﹦绠撻悗姘嚇婵偓闁靛繈鍨婚敍婊堟⒑缂佹◤顏堟倶濮樿泛姹叉い鎺戝閻撴稓鈧厜鍋撻柍褜鍓熷畷浼村冀椤撶偠鎽曢梺鎼炲労閸撴岸寮插鍫熷仯闁诡厽甯掓俊濂告煕閵堝骸澧存慨濠勭帛閹峰懘宕ㄦ繝鍐ㄦ瀾闂備胶顭堥鍡涙儎椤栨繃顥ら梻浣圭湽閸ㄥ鈥﹂崼銉﹀珔闁绘柨鍚嬮悡蹇撯攽閻愯尙浠㈤柛鏃€顨嗘穱濠囧箵閹烘柨顤€缂備胶绮惄顖氱暦閸楃倣鐔兼惞閻熸澘歇闂傚倷绀侀幖顐⑽涚€靛憡宕叉繝闈涙－濞兼牠鏌ц箛鎾磋础缁炬儳鍚嬮幈銊ノ旈埀顒€螞濞嗘挻鍋╅柛顐ｆ礃閻撶喖骞栧ǎ顒€鐏柍缁樻崌閺岋繝宕ㄩ姘ｆ瀰婵犵鍓濋幐鍐茬暦濮椻偓椤㈡瑩宕叉径鍫濆闁哄本娲樼粩鐔碱敍濮橆剦浠鹃梺浼欑悼閸忔ê顫忕紒妯诲闁告稑锕ら弳鍫濃攽閻愭潙绲荤紒缁樏悾宄扳攽閸粍鍕冮梺鍛婃寙鐏為箖鏁滈梻鍌欒兌缁垶宕濋敃鍌氱婵娉涢惌妤呯叓閸ャ劍鐓ｇ紒璇叉閵囧嫰寮介妸褏鐣哄銈呯箳婵炩偓闁哄被鍔岄埥澶娢熸径骞垮€楃槐?闂?闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋涢ˇ鐢稿极閹剧粯鍋愰柤纰卞墻濡茬兘姊绘担鍛婃儓缂佸绶氬畷銏＄鐎ｎ亞锛涢梺璺ㄥ枔婵敻鎮¤箛鎿冪唵閻犺櫣鍎らˉ鐐寸箾閸涱厽鍤囬柡?3 闂傚倸鍊搁崐宄懊归崶顒夋晪鐟滃繘鍩€椤掍胶鈻撻柡鍛█閵嗕礁鈻庨幘鍐插敤濡炪倖鎸鹃崑鐔兼偘閵夈儮鏀芥い鏃€鏋绘笟娑㈡煕濡湱鐭欑€规洩缍€缁犳盯骞橀幇顓燁棃闁轰焦鍔欏畷銊╊敇閻斿壊鍚橀梻鍌欑窔閳ь剛鍋涢懟顖炲储閸濄儳纾奸柤鎼佹涧閸濇椽鏌ｅ☉鍗炴灓闁逞屽墾缂嶅棝宕板Δ鍛；闁规壆澧楅悡鏇㈡煙闁箑鐏犵紒鎲嬪缁?闂?闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴鐐测偓褰掑磿閹寸姵鍠愰柣妤€鐗嗙粭鎺楁煕閵娿儱鈧悂鍩為幋锔藉亹閻庡湱濮撮ˉ婵堢磽娴ｇ懓濮堟い銊ワ躬瀵鎮㈤崗鐓庝罕闂佸壊鍋嗛崰鎾诲礄閿熺姵鈷戦柟鑲╁仜婵″ジ鏌涙繝鍌滅Ш妤犵偛鐗撴俊鎼佸Ψ椤旇棄缂撻梻浣虹《閸撴繈銆冮崨顖滀笉濠电姵纰嶉埛鎴犫偓瑙勬礀濞层劎鏁☉娆愬弿濠电姴鍋嗛悡濂告煕閳规儳浜炬俊鐐€栧濠氬磻閹惧墎纾奸柣妯垮皺鏁堥悗瑙勬礃濞茬喖寮婚崱妤婂悑闁告侗鍨抽弸鍐⒑绾懎顥嶉柟娲讳簽瀵板﹪鎮欓鈧崹鏂库攽閸屾碍鍟為柣鎾寸洴閹﹢鎮欐０婵嗘闂佸憡姊圭划鎾诲蓟閿濆绠婚悗娑欘焽椤︺劎绱撴担铏瑰笡闁烩晩鍨伴悾鐑藉础閻愬秶鍠栧畷顐﹀礋椤愶紕甯涙繝纰夌磿閸嬫垿宕愰弴鐘冲床闁规壆澧楅崑瀣煕閳╁啰鎳呭☉鎾崇Ч閺岋綁濮€閻樺啿鏆堥梺缁樻尭閸熸挳寮诲☉妯锋斀闁糕剝顨忔禒楣冩⒑闂堚晝绋绘俊鐐扮矙瀵?闂?闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箻閺岀喖骞嗛弶鍟冩捇鏌涙繝鍌涘仴闁哄被鍔戝鏉懳旈埀顒佺閹屾富闁靛牆楠搁獮鏍煟韫囨梻绠氶柣蹇斿浮濮婃椽宕楅懖鈹垮仦闂佸搫鎳忕换鍫ｆ濡炪倖鐗滈崑鐐哄磹閸偒娈介柣鎰皺娴犮垽鏌涢弮鈧喊宥夊Φ閸曨垱鏅滈悹鍥皺娴狀垳绱撴笟鍥ф灈妞ゎ厾鍏橀獮濠囧冀椤撶偟鍘撮梺璇″瀻閸屾凹妫滃┑掳鍊楁慨鐑藉磻濞戙垺鍊舵繝闈涱儏缁€澶嬫叏濡灝鐓愰柛濠傜仛閹便劌螣閻撳骸浠橀梺鍝勵儍閸婃妲愰幒妤婃晩闁伙絽鏈崳顓犵磽娴ｈ櫣甯涚紒璇茬墕閻ｇ兘宕奸弴鐐嶁晝鎲稿澶屽祦闁规壆澧楅埛鎺懨归敐鍛暈闁哥喓鍋ら弻娑㈠棘閻愬弶鍣藉☉鎾崇Ч閺岀喐娼忛崜褏鏆犵紓浣插亾濠㈣泛顑嗛崣蹇斾繆椤栨哎浠掗柛姘煎亞閻?闂?闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犵厱婵﹩鍘介妵婵嗏攽闄囬崺鏍ь嚗閸曨厸鍋撻敐搴濈胺婵″弶鍔欏缁樼瑹閳ь剙顭囪婢ф繈姊洪崫鍕櫤闁烩晩鍨堕獮蹇涘箣閿旇棄浜滈柣蹇撶箣閻掞箓寮埀顒勬⒒娴ｈ櫣甯涢柨姘扁偓娈垮枛閻栧ジ鐛弽顓炵疀妞ゆ柨澧介敍婊堟⒑闁偛鑻晶顕€鏌ｉ敐鍡欑疄鐎规洜鍠栭、妤呭磼濮橆剛鐤勬繝鐢靛Х閺佹悂宕戦悙鍝勫瀭闂傚牊绋撻弳锔姐亜閹烘垵顏柛濠傜埣閺岋絽螣閸忓吋姣勭紓浣哄У濡啴寮婚悢鍛婄秶濡わ絽鍟宥夋⒑?
   */
  async submitMonth(packageId: number, dto: DraftSaveRequest, user: RequestUserScope) {
    const pkg = await this.findPackageOrThrow(packageId);
    this.verifyCityOwnership(pkg, user);

    // 1. 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犖ч柛銉㈡櫇閸橆垶姊绘担鍛婂暈婵炶绠撳畷銏ゆ寠婢跺本娈鹃梺鍛婄懃椤﹁京寮ч埀顒勬⒒閸屾氨澧涘〒姘殜瀹曟洟骞囬悧鍫㈠幈?
    this.validateSubmission(dto);

    // 2. 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸ゅ嫰鏌涢锝嗙５闁逞屽墾缁犳挸鐣锋總绋款潊闁炽儱鍟跨花銉╂⒒娴ｇ瓔娼愬鐟版閺呰泛螖閸涱厾锛涢柣搴秵娴滄牠寮ㄦ禒瀣厽婵☆垵顕х徊濠氭煛閸℃瑥浠︾紒缁樼洴瀹曘劑顢涘锝嗙€伴梻浣告惈閻绱炴笟鈧顐﹀箛閺夊灝绐涘銈嗘婵倗鈧碍濞婂?draftSave闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弮鍫熸殰闁稿鎸剧划顓炩槈濡娅ч梺娲诲幗閻熲晠寮婚悢鍛婄秶濡わ絽鍟宥夋⒑缁嬫鍎忔い鎴濐樀閹繝顢曢敃鈧悙濠囨煏婵炑€鍋撴俊鎻掔墦濮婅櫣鎷犻懠顒傤啈濠电偛鎳忓ú妯肩矚鏉堛劎绡€闁搞儴鍩栭弲顒€鈹戦悩缁樻锭婵☆偅顨婇獮鍡涙倷閻戞ǚ鎷?3 闂傚倸鍊搁崐宄懊归崶顒夋晪鐟滃繘鍩€椤掍胶鈻撻柡鍛█閵嗕礁鈻庨幘鍐插敤濡炪倖鎸鹃崑鐔兼偘閵夈儮鏀芥い鏃€鏋绘笟娑㈡煕濡湱鐭欑€规洩缍€缁犳盯骞橀幇顓燁棃闁轰焦鍔欏畷銊╊敇閻斿壊鍚橀梻鍌欑窔閳ь剛鍋涢懟顖炲储閸濄儳纾奸柤鎼佹涧閸濇椽鏌ｅ☉鍗炴灓闁逞屽墾缂嶅棝宕板Δ鍛；闁规壆澧楅悡鏇㈡煙闁箑鐏犵紒鎲嬪缁辨帡顢欓妸銉﹀闁抽攱甯掗妴鎺戭潩閿濆懍澹曟繝鐢靛仒閸栫娀宕堕敐鍌氫壕闁挎洖鍋嗛弫鍥煏韫囧﹥顎嗛柟绋垮暣濮婃椽宕ㄦ繝鍐槱闂佺顑傞崑鎾绘⒑閸濆嫷鍎愭俊顐㈠暣瀵鈽夐姀鈺傛櫇闂佹寧绻傚Λ娑⑺囬妸鈺傗拺缂備焦蓱鐏忎即鏌ｉ悢鍙夋珚妤犵偛鍟抽妵鎰板箳閹寸姴鈧偤姊洪幐搴ｇ畵闁稿﹤鎲＄粋宥嗐偅閸愨晝鍙勯棅顐㈡祫缁茶姤绂嶉悙瑁佺懓顭ㄩ崱妤冨帿缂備胶绮换鍕窗婵犲伣鐔风暋妫颁礁顥氶梻浣告啞閸旀浜稿▎鎰垫闁搞儺鍓氶埛鎴︽偣閸ワ絺鍋撻搹顐や邯闂備胶顭堥敃銉╁箖閸岀偑鈧礁顫濋懜鍨珳婵犮垼娉涢鍛閾忓湱纾藉ù锝呭閸庢挻绻涙径瀣鐎规洘绻堥弫鍐焵椤掑嫧鈧棃宕橀鍢壯囨煕閳╁喚娈橀柣鐔村姂閺岋絾鎯旈姀鐘叉瘓闂佸憡鎸婚悷銊╂倶鐎ｎ亖鏀芥い鏂款潟娴犳粓鏌涚€ｎ偅宕岄柡灞糕偓宕囨殕闁逞屽墴瀹曠増鎯旈妸銉у幒闂佽宕橀褔宕归崒娑栦簻闁哄啫鍊瑰▍鏇灻瑰鍐煟婵﹦绮幏鍛槹鎼存繆顩紓鍌氬€哥粔鎶芥倿閿斿墽鐭夌€广儱顦柋鍥煛閸モ晛浠╅柟?
    await this.draftSave(packageId, dto, user);

    // 3. 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧鏌ｅΟ娆惧殭缂佺姴鐏氶妵鍕疀閹炬惌妫ょ紓浣插亾濠电姴娲﹂悡鍐喐濠婂牆绀堟慨妯块哺瀹曞弶绻涢幋鐐垫噧缂佸墎鍋ら幃妤呮晲鎼粹€茬敖濡炪倧缂氶崡鎶藉箖濡も偓閳绘捇宕归鐣屽蒋闂備胶顭堥鍛存晝閵夛妇鈹嶅┑鐘叉搐闁卞洭鏌￠崶鈺佷户闁稿﹦鍋ゅ娲礃閸欏鍎撻梺鍝ュУ缁嬫挸危閹版澘钃熼柕澶涜吂閹风粯绻涙潏鍓хК婵炲拑绲块弫顔尖槈閵忥紕鍘搁柣蹇曞仩椤曆勪繆娴犲鐓涢柛娑欐緲閻撴劙鏌熼娑欘棃闁炽儻绠撻獮瀣倷鐎涙褰嗛梻鍌氬€搁崐椋庢閿熺姴绀堟繛鍡樺灩閻捇鏌ｉ姀鐘冲暈闁稿鍊块弻锟犲炊閵夈儳浼勯梺鍛婄懄閹瑰洭寮诲☉銏犖ㄩ柍鍝勶攻椤ユ牠姊洪崨濠傜瑲婵犮垺锕㈤垾锕傛嚄椤栵絾顎囬梻浣告憸婵潧顫濋妸銉庯綁骞囬弶璺唺濠德板€愰崑鎾剁磼閻橆喖鍔氶棁澶愭煥濠靛棙顥滅紒鑼额嚙闇夋繝濠傜墢閻ｆ椽鏌″畝鈧崰鎰版晬閹邦厽濯村〒姘煎灡琚﹀┑鐘垫暩閸嬫盯鎮ч崟顖氱闁瑰瓨绻嶅鏍ㄧ箾瀹割喕绨诲ù鑲╁█閺屾盯寮撮妸銉ヮ潻缂備焦鍔栭惄顖氼潖濞差亜浼犻柕澶堝剾閿濆鐓曢柡鍐ｅ亾闁荤啿鏅犻幃浼搭敋閳ь剙鐣烽崡鐑嗘富缂備焦锕╁鏃堟⒒娓氣偓濞佳呮崲閸℃稑鐒垫い鎺嗗亾闁告ɑ鐗犲畷鐘诲冀瑜夐弨浠嬫煟閹邦剛鎽犻悘蹇庡嵆閺屻倛銇愰幒鏃傛毇闂佽桨绀侀崯鎾极閸岀偛绠氱憸婊兾涘鍫熲拺缂佸妫楃€氬嘲鈻撻弴銏＄厽?summaryJson
    const isOverdue = this.isMonthOverdue(dto.monthNo);
    const summary = await this.calculateBusinessSummary(
      packageId,
      dto.monthNo,
      dto.contractRows,
      dto.costRows,
    );

    const snapshot = this.snapshotRepo.create({
      packageId,
      cityId: pkg.cityId,
      reportYear: pkg.reportYear,
      belongMonth: dto.monthNo,
      actualSubmittedAt: new Date(),
      isOverdue: isOverdue ? 1 : 0,
      summaryJson: {
        ...summary,
        isOverdue,
      },
      contractRowsJson: dto.contractRows,
      costRowsJson: dto.costRows,
      maintenanceRowsJson: dto.maintenanceRow || null,
      createdBy: user.userId,
    });

    // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋婵愭綗闁逞屽墮閸婂湱绮嬮幒鏂哄亾閿濆簼绨介柛鏃撶畱椤啴濡堕崱妤€娼戦梺绋款儐閹瑰洭寮诲☉銏″亜闂佸灝顑呮禒鎾⒑缁洘鏉归柛瀣尭椤啴濡堕崱妤€娼戦梺绋款儐閹稿墽妲愰幘鎰佸悑闁告粌鍟抽崥顐⑽旈悩闈涗粶闁哥噥鍋夐悘鎺楁煟閻樺弶绌块悘蹇旂懅缁綁鎮欓悜妯锋嫼閻熸粎澧楃敮鎺撶娴煎瓨鐓曢柟鎯ь嚟缁犳碍銇勯妶鍛偓鍨潖缂佹ɑ濯寸紒娑橆儏濞堫厾绱撴担铏瑰笡閻㈩垪鈧磭鏆﹂柟杈鹃檮閸嬪嫰鏌ｉ幘铏崳闁挎稒鐩铏规喆閸曨偄濮㈡繝鈷€鍐劉缂佸顦鍏煎緞鐎ｎ剙骞嶉梺璇叉捣閺佹悂鈥﹂崼锝傚彺闂傚倷鑳堕…鍫ヮ敄閸℃稑绠查柛銉戝懏娈鹃梺缁樺灩閻℃棃寮崶鈺傚枑闊洦绋戠粈澶愭煙闂傚鍔嶉柛濠傜仛缁绘盯宕煎┑鍫滆檸闂佸搫顑戦梽鍕崲濞戞瑥绶為悗锝庡墯閸掓盯姊烘潪鎵槮闁哥喎鐡ㄩ幈銊╁焵椤掑嫭鐓冮柍杞扮閺嗘瑦銇勬惔銏″磳婵﹦鍎ょ€电厧鈻庨幋婵嗙厒闂備焦妞块崜娆撳Χ缁嬫鍤曢柛鎾茶兌閻瑦绻涢崱娆忎壕閻庨潧鐭傚娲濞戞艾顣哄┑鈽嗗亝椤ㄥ棝骞堥妸鈺佺＜闁绘劕顕崢杈ㄧ節閻㈤潧孝闁哥噥鍨崇划鍫ュ焵椤掆偓椤啴濡堕崱妯尖敍缂備焦鐓＄粻鏍ㄤ繆閸洘鏅插璺猴功椤︺劑姊洪崘鍙夋儓闁哥噥鍋婇悰顕€宕奸妷锔规嫽婵炶揪绲介幉锛勬嫻閿熺姵鐓曢幖瀛樼☉閳ь剚绻堥悰顕€骞囬婊冧簼闂佸憡鍔戦崝搴ㄦ偪閸ヮ剚鈷戦柛娑橈攻婢跺嫰鏌涢幘瀵搞€掔紒顔剧帛閵堬綁宕橀埡浣插亾閸偆绠鹃柟瀵稿仧閹虫劙鏌ｉ幒鏇炐撶紒缁樼洴楠炴捇骞掗弮鈧幉鐓庮渻閵堝啫濡搁柛搴ｆ暬楠炲啫鈻庨幘宕囬獓闂佺懓顕慨宕囨濠靛鈷掑ù锝囨嚀椤曟粎绱掔拠鎻掝伃鐎规洘鍨挎俊鑸靛緞閸艾浜惧ù锝囩《閺嬪酣鏌熼幆褏锛嶆い锔诲弮閹嘲顭ㄩ崟顓犵厐闁告浜跺娲敆閳ь剛绮旈悽绋跨厱闁圭儤鍤氳ぐ鎺撴櫜闁告洦鍣崝鍛存⒑缂佹ê绗掑褏鏅Σ鎰板箳閺冨倻锛滃┑鈽嗗灠閹碱偊锝為幒妤佲拺閻犲洠鈧櫕娈梺鍛婃处閸橀箖鎯侀崼銉︹拺闁硅偐鍋涢崝姗€鏌涢弬鎸庢拱缂佸倸绉磋灃闁告侗鍠掗幏娲煟閻樺厖鑸柛鏂跨焸瀵悂寮惔鎾存杸濡炪倖姊婚埛鍫ュ吹閻斿吋鐓熸慨姗嗗幖閸斻倖銇勯幘鐐藉仮鐎规洖鐖兼俊鎼佸Ψ閿旈敮鍋撴ィ鍐╃厽閹艰揪绱曢悾顓㈡煕鎼淬劋鎲鹃挊婵囥亜閺嶃劎鐭屽☉鎾崇Ч閺岋綁濮€閻樺啿鏆堥梺缁樻尭閸熸挳寮诲☉妯锋斀闁糕剝顨忔禒楣冩⒑闂堚晝绋绘俊鐐扮矙瀵鈽夊锝呬壕闁挎繂绨肩花濠氭煃瑜滈崜娆戠礊婵犲啩绻嗛柣銏㈩焾缁€瀣亜閺嶇數绋婚柡鍛矒濮婃椽宕ㄦ繝鍐槱闂佸憡锕㈢粻鏍箖閿熺姴绫嶉柛顐ゅ暱閹峰姊虹粙鎸庢拱闁荤啙鍥х鐎广儱顦伴崐鐢电磼濡や胶鈽夐柟铏姍閹苯鈻庨幘瀵稿幍闁哄鐗撶粻鏍ь瀶椤曗偓閺屾盯濡堕崱妤€顫嶉梺闈涙搐鐎氭澘顕ｆ禒瀣垫晝妞ゎ偒鍘鹃幑鏇㈡⒒娴ｅ湱婀介柛濞垮€濆畷鎶芥晲婢跺﹨鎽曢悗骞垮劚閻楁粌顬婇妸鈺傗拺闁告稑锕ョ亸鐢告煕閻樺磭澧い鏇悼閹风姴霉鐎ｎ偒娼旈梻渚€娼х换鎺撴叏閻戠瓔鏁婂┑鐘叉处閳锋垿鏌涘┑鍡楊仼闁逞屽墯閹倸顕ｉ幓鎺嗘斀閻庯綆浜跺濠囨⒑闂堟稓澧曟俊顐ｇ洴瀹曘垽妫冨☉杈ㄥ瘜闂侀潧鐗嗗Λ娆撳煕閹烘鐓熼柍鈺佸暞閻撱儵鏌嶇紒妯诲碍妞ゎ厹鍔戝畷鐔煎垂椤愵偄鏅梻鍌欒兌缁垶宕濋弴銏″仱闁靛鍎抽弳锕傛倶閻愪絻妾告繛鍫滅矙閺岋綁骞囬鐔虹▏濠电偞鎯岄崳锝夊蓟閻旂⒈鏁婇柣锝呮湰閸ｄ即姊虹拠鈥虫灕婵☆偄瀚伴崺銏ゅ箻鐠囪尙顔囧Δ?
    const oldSnapshot = await this.snapshotRepo.findOne({
      where: { packageId, belongMonth: dto.monthNo },
      select: ['id'],
    });
    const oldSnapshotId = oldSnapshot?.id ?? null;

    if (oldSnapshotId) {
      await this.snapshotRepo.delete({ id: oldSnapshotId });
    }
    const savedSnapshot = await this.snapshotRepo.save(snapshot);

    // 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箻閺岀喖骞嗛弶鍟冩捇鏌涙繝鍌涘仴闁哄被鍔戝鏉懳旈埀顒佺閹屾富闁靛牆楠搁獮鏍煟韫囨梻绠氶柣蹇斿浮濮婃椽宕楅懖鈹垮仦闂佸搫鎳忕换鍫ｆ濡炪倖鐗滈崑鐐哄磹閸偒娈介柣鎰皺娴犮垽鏌涢弮鈧畝鎼佸蓟閿濆憘鏃堝焵椤掑倹宕叉慨妞诲亾妤犵偛鍟村畷绋课旈埀顒勬倿閸偁浜滈柟鍝勬娴滄儳顪冮妶搴濈盎闁哥喎鐡ㄦ穱濠囧醇閺囩偛鑰垮┑掳鍊愰崑鎾淬亜椤愩垺鍠樻慨濠呮缁瑩宕犻埄鍐╂毎婵犵數鍋涘鍫曟偋閻樻眹鈧礁顫濋懜鍨珳闂佺硶鍓濋崝鏇熺濠靛鈷戦柛娑橈工婵偓闂佸搫鎳忕换鍫濈暦閵忋倕绠瑰ù锝呭帨閹锋椽姊虹涵鍛汗闁稿鐩畷婵嗩潨閳ь剟寮诲☉銏犳閻犳亽鍔庨崝顖氼渻閵堝啫鐏柤褰掔畺閳ワ箓濡搁埡浣哥獩濡炪倕绻愮€氼亝绔熼弴銏＄厽闁绘柨鎽滈幊鍐倵濮樼厧骞樼紒顔肩墛瀵板嫰骞囬鐐╁亾閸洜鍙撻柛銉ｅ妽閳锋帡鏌熼崘鍙夊枠闁哄本鐩崺鐐哄箚瑜屾竟鏇炩攽閿涘嫬浜奸柛濠冪墪椤斿繑绻濆顒傦紱闂佸湱鍋撻悾顏呯濠婂牊鐓欓柣鎴炆戠亸鐢电磼閻橀潧浠滈柍瑙勫灴濡鹃亶鏌涢埡鍌滃⒌妤犵偛妫濆顕€宕煎┑鍫濆Ф闂備礁鎲￠崝鎴﹀礉婢舵劕纾婚柟鎯х摠閸庣喖鏌曟繝蹇氬悅闁归绮换娑欐綇閸撗冨煂闂佺顕滅换婵嬬嵁閸℃稑閱囬柕澶涘閸橀亶姊虹紒妯烩拹婵炲吋鐟﹂幈銊╁磼濠ф儳浜鹃悷娆忓缁€鍐╃箾閸欏顏堚€﹂崶顏嗙杸婵炴垶顭囬崢鎼佹⒑缁嬫寧婀伴柤鐟板⒔閼洪亶濡烽埡鍌楁嫽婵炶揪绲介幉锟犲箚閸儲鐓曢柣鏇氱娴滀即鏌熼銊ュ缁♀偓闂佹悶鍎滈崨顔惧弰濠碉紕鍋戦崐鏍暜閹烘柡鍋撳鐓庡籍闁诡噯绻濆鎾偄缂堢姷鐩庨梻浣筋潐濠㈡ɑ鏅舵惔銊ョ畺闁兼祴鏅濈壕濂告煟濮楀棗鏋涢柛鏃€绮庣槐鎺旂磼濡鈧帒霉閻欏懐鐣电€规洘甯掗～婵嬫晲閸涱剙顥氭繝鐢靛█濞佳囶敄閸涘瓨瀚呴柣鏂垮悑閻撱儲绻涢幋鐏活亪顢旈妶澶嬬厱閻庯綆鍋呭畷宀勬煛娴ｇ懓濮堥柟顖涙閸ㄩ箖鎳犻浣规闂傚倸鍊烽悞锕€顪冮崸妤€鍌ㄥ┑鍌氬閺佸嫰鏌涢埄鍐噭鐎规洖寮剁换婵嬫濞戝崬鍓伴梺缁樺笒閻忔岸濡甸崟顖氱鐎广儱鐗嗛崢锟犳⒑閼姐倕鏋庣紓宥咃躬瀵顓奸崼顐ｎ€囬梻浣告啞閹稿鎮烽埡鍛偓浣割潩閼稿灚娅滄繝銏ｅ煐钃遍柡鍛櫅閳规垿鎮欓崣澶樻￥闂佺顑嗛幐椋庤姳濞差亝鈷掗柛灞捐壘閳ь剟顥撶划鍫熸媴闂堚晞鈧潡姊洪鈧粔瀵稿閸ф鐓熼柕蹇嬪焺閻掗箖鏌ｉ妶澶岀暫闁哄矉绲借灒婵炲棙鍎冲▓顓犵磽娴ｅ搫校闁绘濮撮～蹇旂鐎ｎ亞鍊炲銈嗗煀缁犳垵煤椤撱垹绠犳繝濠傜墛閸婄兘姊洪锝囥€掗柣鈺佸娣囧﹪鎮欓鍕ㄥ亾閺嶎厼绀夐柨鏇炲€哥粈鍫熺箾閹存瑥鐏柛瀣ф櫊閺岋綁濮€閵忊晜姣岄梺绋款儐閹告悂鍩㈤幘璇插瀭妞ゆ梻鏅禍鍫曟⒒娴ｇ儤鍤€闁规祴鍓濈换娑欑節閸ャ劌浠掑銈嗘磵閸嬫挻顨ラ悙鍙夊枠妞ゃ垺锕㈤幃銏犵暋閺夎銈夋⒒閸屾瑨鍏岄柛瀣ㄥ姂瀹曟洘娼忛埡渚囨濡炪倖鎸堕崹瑙勫閻樿绠规繛锝庡墮婵′粙鏌?
    if (oldSnapshotId) {
      await this.operationLogRepo.save(
        this.operationLogRepo.create({
          operatorUserId: user.userId,
          operatorCityId: user.cityId || null,
          actionType: 'snapshot_replaced',
          targetType: 'month_snapshot',
          targetId: String(savedSnapshot.id),
          summaryText: 'Snapshot replaced for city ' + pkg.cityId + ' year ' + pkg.reportYear + ' month ' + dto.monthNo + ': old #' + oldSnapshotId + ' -> new #' + savedSnapshot.id,
          beforeDataJson: { snapshotId: oldSnapshotId },
          afterDataJson: { snapshotId: savedSnapshot.id },
          resultStatus: 'success',
        }),
      );
    }

    // 4. 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犵厱婵﹩鍘介妵婵嗏攽闄囬崺鏍ь嚗閸曨厸鍋撻敐搴濈胺婵″弶鍔欏缁樼瑹閳ь剙顭囪婢ф繈姊洪崫鍕櫤闁烩晩鍨堕獮蹇涘箣閿旇棄浜滈柣蹇撶箣閻掞箓寮埀顒勬⒒娴ｈ櫣甯涢柨姘扁偓娈垮枛閻栧ジ鐛弽顓炵疀妞ゆ柨澧介敍婊堟⒑闁偛鑻晶顕€鏌ｉ敐鍡欑疄鐎规洜鍠栭、妤呭磼濮橆剛鐤勬繝鐢靛Х閺佹悂宕戦悙鍝勫瀭闂傚牊绋撻弳锔姐亜閹烘垵顏柛濠傜埣閺岋絽螣閸忓吋姣勭紓浣哄У濡啴寮婚悢鍛婄秶濡わ絽鍟宥夋⒑閹惰姤鏁遍柛銊ユ健楠炲啳銇愰幒鎴犲€為梺鎸庣箓閸婂憡绂嶆ィ鍐╃厱闁归偊鍘肩徊鑽ょ磼閻橀潧顣肩紒缁樼箘閸犲﹥寰勫畝鈧敍鐔兼⒑缁嬫鍎戦柛瀣枛瀵偊顢氶埀顒勫箖濞嗘挸浼犻柛鏇ㄥ弾閸?submitted
    await this.packageRepo.update(packageId, {
      status: PackageStatus.SUBMITTED,
      lastUpdatedBy: user.userId,
      lastUpdatedAt: new Date(),
    });

    // 5. 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箻閺岀喖骞嗛弶鍟冩捇鏌涙繝鍌涘仴闁哄被鍔戝鏉懳旈埀顒佺閹屾富闁靛牆楠搁獮鏍煟韫囨梻绠氶柣蹇斿浮濮婃椽宕楅懖鈹垮仦闂佸搫鎳忕换鍫ｆ濡炪倖鐗滈崑鐐哄磹閸偒娈介柣鎰皺娴犮垽鏌涢弮鈧喊宥夊Φ閸曨垱鏅滈悹鍥皺娴狀垳绱撴笟鍥ф灈妞ゎ厾鍏橀獮濠囧冀椤撶偟鍘撮梺璇″瀻閸屾凹妫滃┑掳鍊楁慨鐑藉磻濞戙垺鍊舵繝闈涱儏缁€澶嬫叏濡灝鐓愰柛濠傜仛閹便劌螣閻撳骸浠橀梺鍝勵儍閸婃妲愰幒妤婃晩闁伙絽鏈崳顓犵磽娴ｈ櫣甯涚紒璇茬墕閻ｇ兘宕奸弴鐐嶁晝鎲稿澶屽祦闁规壆澧楅埛鎺懨归敐鍛暈闁哥喓鍋ら弻娑㈠棘閻愬弶鍣藉☉鎾崇Ч閺岀喐娼忛崜褏鏆犵紓浣插亾濠㈣泛顑嗛崣蹇斾繆椤栨哎浠掗柛姘煎亞閻?
    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId: user.userId,
        operatorCityId: user.cityId || null,
        actionType: 'submit_month',
        targetType: 'month_snapshot',
        targetId: String(savedSnapshot.id),
        summaryText: 'Submitted package #' + pkg.cityId + ' year ' + pkg.reportYear + ' month ' + dto.monthNo + (isOverdue ? ' (overdue)' : ''),
        beforeDataJson: null,
        afterDataJson: {
          packageId,
          monthNo: dto.monthNo,
          isOverdue,
          completionTotal: (snapshot.summaryJson as Record<string, unknown> | null)?.completionTotal ?? null,
          costTotal: (snapshot.summaryJson as Record<string, unknown> | null)?.costTotal ?? null,
        },
        resultStatus: 'success',
      }),
    );

    return {
      success: true,
      packageId,
      monthNo: dto.monthNo,
      submittedAt: new Date().toISOString(),
      snapshotId: savedSnapshot.id,
    };
  }

  // ============================================================
  // Admin 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛銈呭閺屻倝骞栨担瑙勯敪闂佹悶鍔嶅Λ鍐箖濡ゅ懏顥堟繛鎴炵懃閺嗗牆顪冮妶搴′簼婵炶尙鍠栧濠氭晸閻樿尙鍊為梺闈涱槶閸庤櫕绂掗懖鈺冪＝濞达絽鎼牎闂佺粯顨嗗ú鐔煎春閻愬搫绠ｉ柨鏃囨娴滃綊姊洪崨濠勬噧妞わ缚鍗抽獮鍐ㄢ枎韫囧﹥鏂€闂佸疇妫勫Λ妤佺濠靛鐓ラ柡鍥悘鍙夘殽閻愭彃鏆欓柣锝忕節楠炲秹鎼归銈傚亾婵犳碍顥婃い鎰╁灪婢跺嫰鏌熺亸鏍ㄦ珕閻庨潧銈搁崺鈧い鎺戝閳?
  // ============================================================

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲忛崕鎶藉焵椤掑﹦绉甸柛鐘崇墱婢规洟宕稿Δ浣哄幍闂佽鍨虫晶妤吽夋径鎰闁哄鍩婇煬顒勬煛鐏炶鈧繈骞婂┑瀣妞ゆ棁鍋愭晶顖氣攽閻愯尙鎽犵紒顔肩灱缁辩偞绻濋崶褑鎽曞┑鐐村灟閸ㄧ懓鏁俊鐐€栧濠氬储瑜旈敐鐐哄煛閸愵亞锛濇繛杈剧到閹碱偉鈪烽梻浣侯焾濞寸兘寮拠宸殨閻犲洤妯婇崥瀣煕椤愵偄浜濇い搴℃喘濮婄粯鎷呴崨濠傛殘闂佽鎮傜粻鏍х暦閻楀牊鍎熸い顓熷灦閺咁亪姊洪幐搴ｇ畵妞わ富鍨跺畷褰掑磼濞戞牔绨婚梺瑙勫閺呮盯鎮橀鍓х＜闁归偊鍠栨禒锔剧磼缂佹绠為柟顔荤矙濡啫霉闊彃鐏查柟顔筋殔椤繈鎮℃惔鈽嗘骄闂備浇妗ㄧ欢锟犲闯閿濆绠栨繛鍡樻尰閸婄粯淇婇婊冨付妤犵偞顨婂缁樼瑹閳ь剙顭囪閹广垽宕卞☉妯兼煣濠电偞鍨崹娲磹閸洘鐓熸俊顖濆亹鐢盯鏌ｉ幘瀛樼闁宠鍨块幃鈺呭矗婢跺鈧稑鈹戦悙鎻掓倯闁告梹鐟╁濠氭偄閸濄儳鎳濋梺鍓茬厛閸犳牠锝為崶銊х瘈缁剧増菤閸嬫挸鐣烽崶褏鍘介柣搴ゎ潐濞叉牠鎮ラ崗闂寸箚闁归棿绀佸敮闂侀潧鐗嗗ú顓㈠箰婵傚憡鈷掗柛灞捐壘閳ь剟顥撳▎銏狀潩椤掑鍔烽悷婊勬閸ㄩ箖鏁冮崒姘跺敹闂侀潧顦崕鎶芥晬閻斿吋鈷掑〒姘搐婢ь喚绱掓径灞炬毈鐎规洘娲樼换婵嬪炊閵娧冨箞婵＄偑鍊栭崝褏寰婇崜褏鐭嗛柛鎰靛枟閻撶喖鏌熼幆褏鎽犵紒鈧€ｎ喗鐓涚€光偓閳ь剟宕伴弽顓炵畺婵犲﹤鍚橀悢铏圭＜婵☆垰鎼竟鍡椻攽閻樺灚鏆╅柛瀣洴閹勭節閸ャ劌浠梺鍐叉惈閹冲酣鎷戦悢鍏肩厸闁搞儯鍎遍悘鈺傤殽閻愵亜鐏ǎ鍥э躬婵″爼宕掑顐㈩棜闂傚倷绀侀幖顐⑽涚€靛摜绀婂〒姘ｅ亾鐎殿喖顭烽崺鍕礃閳轰緡鈧捇姊洪崨濠勭細闁稿孩绋栭ˇ鎾煃瑜滈崜婵嬶綖婢跺⊕鍝勵煥閸繂鍋嶉悷婊勬瀹曟椽鎮欓崫鍕吅闂佹寧娲嶉崑鎾绘煟閹邦剨鍔熼柟鑼焾椤撳ジ宕卞▎鎴濋獎闁诲骸绠嶉崕閬嵥囨导鏉戠厱闁圭儤鍤氳ぐ鎺撴櫜闁告侗鍠栭弳鍫ユ⒑鐠団€崇仩闁绘鎹囧濠氭晲閸涘倹妫冮崺鈧い鎺嗗亾閾荤偞绻濋棃娑卞剰缂佺姵鐗滈幉鎼佸棘鐠恒劍娈鹃梺鍛婎殘閸嬫劙寮告惔銊﹀€堕柣鎰綑閻忓﹤顭跨憴鍕缂佽鲸甯炵槐鎺楀閻樿尙顔愰梻浣烘嚀閸熻法鎹㈠鈧獮鍐偨閸撳弶鏅滈梺绯曞墲閻熝囨晬濠婂牊鐓熼幖鎼灣缁夐潧霉濠婂棙纭鹃崡閬嶆煕閿旇骞樼痪鎹愬亹缁辨挻鎷呯拠锛勫姺缂備胶濮甸悧鐘诲蓟閻旈鏆嬮柣妤€鐗嗗▓妤呮⒑閸︻厼甯舵繝鈧柆宥呯疅闁圭虎鍠栫粈瀣亜閹板墎绋绘い鏃€甯″濠氬磼濮橆兘鍋撻幖浣哥９濡炲娴烽惌鍡椼€掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏℃櫇闁逞屽墰婢规洟宕烽鐘碉紲闁诲函缍嗛崑鎾舵閳哄啯鍠愰柣妤€鐗嗙粭鎺旂磼閳ь剛鈧綆鍋佹禍婊堟煙閹规劖纭炬繛鍛箲缁?
   */
  async listAllPackages(): Promise<PaginatedResponse<AdminPackageItem>> {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧鏌ｅΟ娆惧殭缂佺姴鐏氶妵鍕疀閹炬惌妫ょ紓浣插亾濠电姴娲﹂悡鍐喐濠婂牆绀堟慨妯块哺瀹曞弶绻涢幋鐐垫噧缂佸墎鍋ら幃妤呮晲鎼粹€茬敖濡炪倧缂氶崡鎶藉箖?JOIN 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾剧粯绻涢幋娆忕労闁轰礁顑嗛妵鍕箻鐠虹儤鐎鹃梺鍛婄懃缁绘﹢骞冨Δ鍛仺闁汇垻鍋ｉ埀顒€锕弻娑氣偓锝庡亝鐏忣參鏌嶉挊澶樻█妤犵偞甯￠獮妯尖偓鐢殿焾缂嶅啴姊虹拠鎻掝劉妞ゆ梹鐗犲畷鏉课旀担铏诡啎婵犵數濮村ú銈囩不閺嶎厽鐓忛煫鍥ь儏閳ь剚鐗犲畷鎴﹀磼閻愯尙顔愰柡澶婄墕婢х晫绮旈悽鍛婄厱闁绘劙顤傚鎰庨崶褝韬柟顔界懇椤㈡棃宕熼妸銉ゅ闂佸搫绋侀悘娑樷槈濞嗘垹鎳濋梺閫炲苯澧柣锝囧厴楠炲鏁冮埀顒傜不濞戞瑣浜滈柟鐑樺焾濡插綊鏌涘鍥ㄦ毈婵﹥妞藉Λ鍐归妷銉уⅵ鐎殿喗褰冮…銊╁醇閻旇渹绨甸梻浣虹帛閺屻劑宕ョ€ｎ喗鍋傞柛鎰靛枛缁狙囨煟閹邦厽缍戞い搴㈢矒閺屾稖绠涢幘鍓佸姱闂佸搫鐬奸崰鏍箖閸撗傛勃閻熸瑱绲鹃悗浼存⒒娴ｇ瓔鍤冮柛鐘虫礈閸掓帒鈻庨幘鎵佸亾娴ｇ硶妲堟俊顖炴敱椤秴鈹戦悙鍙夘棞缂佺粯鍔欏銊╊敇閵忊檧鎷绘繛杈剧到閹诧紕鎷归敓鐘崇厱閻庯絻鍔屾慨鍌溾偓瑙勬礈椤㈠﹪濡甸幇鏉跨闁规儳鍘栭幃锝夋⒒娴ｈ姤纭堕柛鐘虫尰閹便劎鈧潧鎽滃Λ顖滄喐閺冨牆绠栫憸鐗堝笒缁犳帡鏌熼悜妯虹仴妞ゎ剙顦靛铏圭矙鐠恒劍鍣抽梺鎼炲劘閸斿骞忕紒妯肩閺夊牆澧界粔顒佺箾閸滃啰绉┑鈥崇摠缁绘繈宕堕妸褍骞愰梻浣告啞娓氭宕板璺虹厐闁哄洨鍠嗘禍婊堟煏婵犲繒鍒伴柛鏃撳閳ь剝顫夊ú锕傚磻婵犲啩绻嗛柣銈庡灱濡插鎮楃憴鍕８闁稿酣娼ч～蹇撁洪鍕槶闂佸湱绮敮濠勮姳閻撳簶鏀介柣鎰絻缁狙囨煟濡や胶鐭掓鐐差樀楠炴﹢顢欓懞銉︾彆闂傚倷鐒﹂娆撳垂閻楀牏顩查柣鎰靛墻濞堜粙鏌ｉ幇顖氱毢濞寸姰鍨介弻娑㈠籍閳ь剛鍠婂鍥ㄥ床婵炴垶鐟ョ欢鐐寸箾閹寸偞鐨戦柡鍡愬€濆铏规嫚閳ヨ櫕鐏嶉梺鑽ゅ暱閺呯娀鐛崘顭戠叆闁稿繐澧介崰鎾舵閹烘嚦鐔兼偂鎼达紕绱﹂梻鍌氬€峰ù鍥敋瑜庨〃銉╁箹娴ｇ鍋嶅┑鐘诧工閻楀棛澹曟繝姘厵闁告挆鍛闂佺粯鎸诲ú鐔煎蓟閿熺姴鐐婇柕澶堝劚椤棛绱撴担闈涘闁哄拋鍋嗗Σ鎰板箳閹惧绉堕梺闈涱焾閸庨亶骞楅棃娑掓斀?TypeORM bigint闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴鐐测偓鍝ョ矆閸喐鍙忔俊顖涘绾墽鐥幆褜鐓奸柡灞剧☉閳藉宕￠悙瀵镐憾闂備礁鎲￠悷銉ф崲濮椻偓瀵鏁愭径妯绘櫆闂佸憡渚楅崹濂稿极濮婃g 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亜顒㈡い鎰矙閺屻劑鎮㈤崫鍕戙垻鐥幑鎰靛殭妞ゎ厼娼￠幊婊堟濞戞鏇㈡⒑鏉炴壆顦︽い鎴濇喘楠炲骞栨担鍝ョ潉闂佸壊鍋呯换鍕偩閸濆嫧鏀介幒鎶藉磹閺囥垹绠犻煫鍥ㄧ⊕閸嬪倿鏌曟径鍡樻珕闁稿﹦鏁婚弻銊モ攽閸℃侗鈧鏌涘Ο缁樺唉闁哄矉绱曢埀顒婄秵閸嬪棙鏅堕悽鍛婄厵妞ゆ梻鐡斿▓婊堟煟濞戝崬娅嶇€规洖缍婇、娆撴偂鎼搭喗缍撻梻鍌氬€烽懗鍫曞箠閹捐鐤柛褎顨嗛悡鈧梺鎸庣箓椤︻垳绮婚弽顓熺厪濠㈣泛妫欏▍鍡涙煟閹烘洖浜归柍褜鍓欑粻宥夊磿閸楃倣娑樼暆閸曨偆顔?
    const rawRows = await this.packageRepo
      .createQueryBuilder('pkg')
      .leftJoin(CityEntity, 'city', 'city.id = pkg.cityId')
      .select([
        'pkg.id AS id',
        'pkg.city_id AS cityId',
        'city.name AS cityName',
        'pkg.report_year AS reportYear',
        'pkg.status AS status',
        'pkg.last_updated_by AS lastUpdatedBy',
        'pkg.last_updated_at AS lastUpdatedAt',
        'pkg.created_at AS createdAt',
        'pkg.updated_at AS updatedAt',
      ])
      .where('pkg.report_year = :year', { year: currentYear })
      .orderBy('pkg.city_id', 'ASC')
      .getRawMany();

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗霉閿濆牊顏犵紒鈧繝鍌楁斀闁绘ɑ褰冩禍鐐烘煟閹烘梹娅曢柟鍙夌摃缁犳盯寮撮悤浣圭稐闂備胶绮崝鏇㈩敋椤撶姴濮柍褜鍓熷娲箹閻愭彃濡ч梺鎼炲労閻撳妲愰鈧埞鎴︽偐閸偅姣勯梺绋款儐缁嬫垼鐏掓繝鐢靛Т閸熶即銆呴崣澶岀瘈濠电姴鍊绘晶娑㈡倵濮橆剚鍤囬柡宀嬬秮瀵剟宕归钘夆偓顖炴⒑缂佹ɑ灏紒缁樺姍閳ワ箓宕稿Δ浣告疂濠电偛鐗愬▔鏇㈠礉閻戣姤鈷戦柛娑橆焵閹达附鍎庢い鏍仜閽冪喐绻涢幋娆忕仼閸ユ挳姊洪崨濠佺繁闁告瑥瀛╃€靛ジ鍩€椤掑嫭鈷掑ù锝囧劋閸も偓閻庢鍠栭悥濂哥嵁閸愵喖纾奸柣鎰皺閻ｆ椽鎮峰鍕叆闁伙綁鏀辩缓浠嬪川婵犲倷绨婚梻浣虹帛閸ㄥ綊寮查锕€鐒垫い鎺戝€搁崝瀣磼缂佹绠為柟顔荤矙濡啫霉閼哥數娲撮柡灞剧〒閳ь剨缍嗛崑鍛暦瀹€鍕厸閻忕偟鏅暩濡炪伇鍌滅獢闁哄本鐩獮妯兼崉閻戞浜梻浣筋嚃閸ｎ垳鎹㈠┑瀣ㄢ偓渚€寮撮姀鈩冩珖闂侀€炲苯澧撮柟顔界懄缁绘繈宕堕妸銉ゅ寲濠德板€ч梽鍕偓绗涘洤违闁告劦浜炵壕濂告煏婵炲灝鈧鎯屽▎鎰弿濠电姴鍟妵婵堚偓瑙勬磸閸斿秶鎹㈠┑瀣妞ゆ巻鍋撴繛鍛灴濮婂宕掑▎鎴М闁圭厧鐡ㄧ划搴☆嚗婵犲啰顩烽悗锝庡亜娴犲ジ姊虹紒妯虹仼闁烩剝妫冨顐﹀磼閻愬鍘遍梺鏂ユ櫅閸燁垳绮堥崘顔界厱闁哄洨鍋涢弳锝嗘叏婵犲懏顏犻柟椋庡█閸ㄦ儳鐣烽崶锝呬壕濠电姵纰嶉悡鏇熺箾閹存繂鑸规鐐村姍閺屾稓鈧綆鍋呭畷灞绢殽閻愭潙娴鐐达耿瀹曟粍绗熼崶褎娅楅梻鍌欐祰椤曆呪偓娑掓櫇缁瑩骞掑Δ浣规珨濠电姷鏁搁崑娑㈡偋韫囨梻绠鹃柍褜鍓熼弻锛勪沪閸撗€濮囩紓浣虹帛缁诲牆鐣峰鈧、鏃堝川椤撶偟浠繝纰夌磿閸嬫垿宕愰幋锕€鍨傛繛宸簼閺呮繈鏌曡箛瀣偓妤€鐣垫笟鈧弻鈥愁吋閸愩劌顬夋繝娈垮灡閹告娊寮诲☉妯锋婵鐗嗘慨娑㈡⒑?
    const submittedCityIds = new Set<number>();
    const snapshotCounts = new Map<number, number>();

    const snapshots = await this.snapshotRepo
      .createQueryBuilder('s')
      .select(['s.cityId', 's.belongMonth'])
      .where('s.reportYear = :year', { year: currentYear })
      .getMany();

    for (const s of snapshots) {
      const cityId = Number(s.cityId);
      if (s.belongMonth === currentMonth) {
        submittedCityIds.add(cityId);
      }
      snapshotCounts.set(
        cityId,
        (snapshotCounts.get(cityId) || 0) + 1,
      );
    }

    const items: AdminPackageItem[] = rawRows.map((row) => ({
      id: Number(row.id),
      cityId: Number(row.cityId),
      cityName: row.cityName ?? ('City #' + row.cityId),
      reportYear: Number(row.reportYear),
      status: row.status,
      currentMonthSubmitted: submittedCityIds.has(Number(row.cityId)),
      submittedMonthCount: snapshotCounts.get(Number(row.cityId)) || 0,
      lastUpdatedBy: row.lastUpdatedBy ? Number(row.lastUpdatedBy) : null,
      lastUpdatedAt: row.lastUpdatedAt?.toISOString() ?? null,
      createdAt: row.createdAt?.toISOString() ?? '',
      updatedAt: row.updatedAt?.toISOString() ?? '',
    }));

    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亜顒㈡い鎰矙閺屻劑鎮㈤崫鍕戙垻鐥幆褜鐓奸柡灞界Х椤т線鏌涢幘璺烘灈鐎殿喛顕ч埥澶婎潩閿濆懍澹曢梺鎸庣箓妤犲憡绂嶅┑鍫氬亾鐟欏嫭绀€闁活厼鍊垮濠氭晬閸曨亝鍕冮梺鍛婃寙閸曨偄鐏℃繝鐢靛Х椤ｎ喚妲愰弴銏犺摕濠㈣埖鍓濋崶顒€绠甸柟瑙勵殔缂嶅﹪骞冮鍫濆窛妞ゆ牗绮嶅▓鎼佹⒒娴ｅ摜鏋冩い顐㈩樀瀹曞綊宕稿灏栧亾娴ｇ硶鏋庨柟鎯у帠缁卞爼姊洪崨濠冪８闁告柨鏈粋宥夋倷椤戣法绠氶梺闈涚墕閹冲繘宕抽崷顓犵＜闁绘ê纾晶顏堟婢舵劖鐓曢煫鍥ㄦ尭閹垹绱撳鍡楃伌妤犵偛妫濋幃銏ゅ礂鐏忔牗瀚奸梻鍌氬€搁悧濠冪瑹濡も偓鍗遍柛顐ｆ礃閻撴洟骞栫划鍏夊亾閾忣偅鐦ｉ梺鍙ョ串缁蹭粙濡撮幒鎴僵闁挎繂鎳嶆竟鏇熺節濞堝灝鏋涢柨鏇樺劚椤啴鎸婃径灞炬闂侀潧顭俊鍥╁姬閳ь剟姊虹粙鎸庢拱缂侇喖閰ｉ獮濠囧冀瑜夐弨浠嬫煟濡澧柛鐔风箻閺屾盯濡搁埡鍌涢敪闁捐崵鍋ら弻娑㈠即閵娿儳浠梺绋款儌閺呯娀寮婚敐澶娢ч幖杈剧磿娴狀垶姊哄Ч鍥р偓鎰板磻閹剧粯鈷掑ù锝呮啞閹牊绻涚仦鍌氬闁逛究鍔戦幃婊堟嚍閵夈儰绨?
   */
  async returnToDraft(
    packageId: number,
    dto: ReturnToDraftRequest,
    user: RequestUserScope,
  ): Promise<{ success: boolean; message: string }> {
    const pkg = await this.findPackageOrThrow(packageId);

    if (pkg.status !== PackageStatus.SUBMITTED) {
      throw new BadRequestException('Package #' + packageId + ' is not submitted; cannot return to draft');
    }

    await this.packageRepo.update(packageId, {
      status: PackageStatus.DRAFT,
      lastUpdatedAt: new Date(),
    });

    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId: user?.userId ?? 0,
        actionType: 'return_to_draft',
        targetType: 'annual_report_package',
        targetId: String(packageId),
        summaryText: 'Admin returned package #' + packageId + ' (city ' + pkg.cityId + ', year ' + pkg.reportYear + ', month ' + dto.monthNo + '): ' + dto.reason,
        resultStatus: 'success',
      }),
    );

    return { success: true, message: 'Package #' + packageId + ' returned to draft' };
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煟閵忋埄鐒剧紒鎰殜閺岀喖骞嶉纰辨毉闂佺顑戠换婵嗩嚕閸洖閱囨慨姗嗗幗閻濇牜绱撴担鎻掍壕婵犵數濮撮崐鍫曞焵椤掍礁绗掓い顐ｇ箞閺佹劙宕ㄩ鈧ˉ姘舵⒑鐠囨彃顒㈡い鏃€鐗犲畷浼村箻鐠囪尙顦梺纭呮彧缁犳垿寮告笟鈧弻鐔兼焽閿曗偓楠炴牜绱掗崜浣镐粶闁宠鍨块幃鈺呭箵閹哄棗浜鹃柛娑橈功椤╂煡鏌涢锝嗙闁抽攱甯掗湁闁挎繂鐗婇鐘绘煏閸℃韬柡灞剧洴楠炴鈧潧鎽滈悿鍕⒑闂堟稒顥滈柛鐔告綑閻ｇ兘濡歌閸嬫挸鈽夊▍顓т邯椤㈡梻鎲撮崟顓犵槇闂侀潧楠忕徊浠嬫偂閹扮増鐓曢柡鍐ｅ亾闁绘濞€楠炲啴鍨鹃弬銉︻潔闂侀潧楠忕槐鏇㈠储閸楃儐娓婚柕鍫濇婵呯磼閼艰埖纭剁紒顔款嚙铻ｅ〒姘煎灣閸炵敻鎮峰鍐€楅摶鐐烘煕閹伴潧鏋涢柦?
   */
  async unlockMonths(
    packageId: number,
    dto: UnlockMonthsRequest,
    user: RequestUserScope,
  ): Promise<{ success: boolean; message: string; unlockedMonths: number[] }> {
    const pkg = await this.findPackageOrThrow(packageId);

    const grants = dto.months.map((monthNo) =>
      this.unlockGrantRepo.create({
        packageId,
        monthNo,
        expiresAt: new Date(dto.expiresAt),
        grantedBy: user?.userId ?? 0,
        reason: dto.reason ?? null,
      }),
    );

    await this.unlockGrantRepo.save(grants);

    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId: user?.userId ?? 0,
        actionType: 'unlock_months',
        targetType: 'month_unlock_grant',
        targetId: String(packageId),
        summaryText: 'Unlocked months for package #' + packageId + ' (city ' + pkg.cityId + ', year ' + pkg.reportYear + '): [' + dto.months.join(', ') + '], expiresAt=' + dto.expiresAt,
        resultStatus: 'success',
      }),
    );

    return {
      success: true,
      message: 'Unlocked ' + dto.months.length + ' month(s).',
      unlockedMonths: dto.months,
    };
  }

  async bulkUnlockMonths(
    dto: BulkUnlockMonthsRequest,
    user: RequestUserScope,
  ): Promise<BulkUnlockMonthsResponse> {
    const year = Number(dto.year ?? new Date().getFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Year must be between 2000 and 2100');
    }

    const rawMonths: number[] = Array.isArray(dto.months)
      ? dto.months.map((month: number) => Number(month))
      : [];
    const invalidMonths = rawMonths.filter(
      (month: number) => !Number.isInteger(month) || month < 1 || month > 12,
    );
    if (rawMonths.length === 0 || invalidMonths.length > 0) {
      throw new BadRequestException('Month must be between 1 and 12');
    }

    const months: number[] = Array.from(new Set<number>(rawMonths)).sort((a, b) => a - b);
    const expiresAt = new Date(dto.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('Invalid unlock expiration time');
    }
    const now = new Date();
    if (expiresAt <= now) {
      throw new BadRequestException('Unlock expiration time must be in the future');
    }

    const packages = await this.packageRepo.find({
      where: { reportYear: year },
      select: ['id', 'cityId', 'reportYear'],
    });

    if (packages.length === 0) {
      return {
        success: true,
        message: year + ' has no report packages to unlock',
        packageCount: 0,
        createdGrantCount: 0,
        skippedActiveGrantCount: 0,
        unlockedMonths: months,
      };
    }

    const packageIds = packages.map((pkg) => Number(pkg.id));
    const activeGrants = await this.unlockGrantRepo.find({
      where: {
        packageId: In(packageIds),
        monthNo: In(months),
        expiresAt: MoreThan(now),
      },
    });
    const activeGrantKeys = new Set(
      activeGrants.map((grant) => Number(grant.packageId) + ':' + Number(grant.monthNo)),
    );

    const grants = packages.flatMap((pkg) =>
      months
        .filter((monthNo: number) => !activeGrantKeys.has(Number(pkg.id) + ':' + monthNo))
        .map((monthNo: number) =>
          this.unlockGrantRepo.create({
            packageId: Number(pkg.id),
            monthNo,
            expiresAt,
            grantedBy: user?.userId ?? 0,
            reason: dto.reason ?? null,
          }),
        ),
    );

    if (grants.length > 0) {
      await this.unlockGrantRepo.save(grants);
    }

    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId: user?.userId ?? 0,
        actionType: 'bulk_unlock_months',
        targetType: 'annual_report_package',
        targetId: String(year),
        summaryText: 'Bulk unlocked report packages for year ' + year + ', months [' + months.join(', ') + '], created ' + grants.length + ', skipped ' + activeGrants.length + ', expiresAt ' + dto.expiresAt,
        resultStatus: 'success',
      }),
    );

    return {
      success: true,
      message: 'Bulk unlocked ' + packages.length + ' report packages for ' + year + ', months [' + months.join(', ') + ']',
      packageCount: packages.length,
      createdGrantCount: grants.length,
      skippedActiveGrantCount: activeGrants.length,
      unlockedMonths: months,
    };
  }
  /**
   * Open a specific month contract row for editing.
   *
   * Rules:
   * 1. Contract must be allocated to the package city, otherwise 400.
   * 2. Repeated calls are idempotent.
   * 3. Month must be between 1 and 12; historical months are allowed.
   * 4. Submitted months still require unlock-months before city users can edit.
   */
  async openCurrentMonthContract(
    packageId: number,
    dto: OpenCurrentMonthContractRequest,
    user: RequestUserScope,
  ): Promise<{ success: boolean; message: string }> {
    const pkg = await this.findPackageOrThrow(packageId);

    // Validate requested month only; historical months are allowed.
    if (dto.monthNo < 1 || dto.monthNo > 12) {
      throw new BadRequestException('monthNo must be between 1 and 12');
    }

    // Rule 1: contract must belong to the package city.
    const allocation = await this.allocationRepo.findOne({
      where: { contractId: dto.contractId, cityId: pkg.cityId },
    });
    if (!allocation) {
      throw new BadRequestException(
        'Contract #' + dto.contractId + ' is not allocated to package city #' + pkg.cityId,
      );
    }

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犖ч柛鈩冦仦缁剝淇婇悙顏勨偓鏍礉瑜忕划濠氬箣閻樺樊妫滈梺绉嗗嫷娈曢柣鎾存礃缁绘盯宕卞Δ浣侯洶濠碘€冲级濡炰粙寮婚敐鍛斀濠电姴鍊婚崢顐︽⒑闁稓鈹掗柛鏂跨焸閳ユ棃宕橀鍛彴闂傚鍋掗崢濂杆夊顑芥斀閹烘娊宕愬Δ浣瑰弿闁绘垼妫勭壕缁樼箾閹存瑥鐒洪柡浣稿椤法鎹勬笟顖滃彆闂佹悶鍊栧ú鐔煎蓟濞戞瑧绡€闁告洦鍋呴悵鈥斥攽閳╁啫绲绘い顓炲槻椤繘鎼圭憴鍕彴闂佸搫琚崕鍐茬暦椤忓棛纾藉ù锝勭矙閸濈儤绻涢懠顒€鏋涚€规洘妞介崺鈧い鎺嶉檷娴滄粓鏌熼悜妯虹仴闁逞屽墮閹诧紕绮嬮幒妤婃晬闁绘劕顕崢杈ㄧ節閻㈤潧孝闁哥噥鍨崇划鍫⑩偓锝庡亽濞堜粙鏌ｉ幇顒夊殶濠⒀冪仛閵囧嫰濮€閳╁啰顦版繝纰樷偓宕囧煟鐎规洖鐖奸崺鈩冪節閸愬喛绠撳缁樻媴缁涘娈梺鍛婂灩閺咁偆妲愰悙鍝勫耿婵炴垶顭囬悰銉╂⒑閸濆嫮鈻夐柛瀣у亾闂佺顑嗛幐鎼侊綖濠靛鏁嗗璺侯儌閺嬪懘姊绘担鍛婃儓闁哄牜鍓熼幆鍕敍閻愵亖鍋撴笟鈧鎾閳╁啯鐝抽梻浣规偠閸庮噣寮插┑瀣辈妞ゆ劧闄勯埛鎺懨归敐鍕劅闁绘帞鍋撻妵鍕敇閻愰潧鈪甸悗瑙勬礃閸旀洟鍩為幋鐘亾閿濆簼娴烽柟鑺ユ礀閳规垿鎮欓弶鎴犱桓闂佹寧娲嶉弲娑⑩€﹂崶顒€鐓涢柛灞久肩花濠氭⒑閸︻厼鍔嬮柛銊ф暬閸┾偓妞ゆ巻鍋撴い顓炲槻閻ｅ嘲鈹戠€ｅ灚鏅╃紒鐐妞村摜鈧?
    let row = await this.contractRowRepo.findOne({
      where: {
        packageId,
        contractId: dto.contractId,
        monthNo: dto.monthNo,
      },
    });

    if (row) {
      // 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煟閵忋埄鐒剧紒鎰殜閺岀喖骞嶉纰辨毉闂佺顑戠换婵嬪蓟閺囩喓鐝舵い鏍殔娴滈箖姊虹粙娆惧剱闁瑰憡鎮傞敐鐐测攽鐎ｎ偄浜楅柟鑲╄ˉ濡狙囧箯椤愶附鐓?2闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弮鍫熸殰闁稿鎸剧划顓炩槈濡娅ч梺娲诲幗閻熲晠寮婚悢鍏煎€绘慨妤€妫欓悾鐑芥⒑閹肩偛鈧洟鎯岄崒鐐茶摕婵炴垯鍨圭粻缁樹繆閵堝倸浜鹃梺鐟板暱缁夊墎鍒掗鐔风窞闁归偊鍘搁幏娲煟閻斿摜鎳冮悗姘煎墴瀹曟繈濡堕崪浣哄數閻熸粌绉堕埀顒佺▓閺呯姵淇婇棃娑掓瀻闁规儳纾ˇ銊╂倵閻熸澘顥忛柛鐘冲哺瀹曨剟鎮介崨濠勫幗闂佺粯顭囬崕銈夊Υ閸愵喗鍋ｉ柍褜鍓熼弫鍐磼濮樻唻绱甸柣搴″帨閸嬫捇鏌涢弴銊ュ闁?
      if (row.isLocked === ContractRowLockStatus.UNLOCKED) {
        const hasData = row.completionAmount > 0 || row.acceptanceAmount > 0;
        return {
          success: true,
          message: hasData
            ? 'Contract already open and has data; kept existing values'
            : 'Contract already open',
        };
      }

      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛濠电姷顣换婵嗩焽瑜戦悘鎺楁⒑閸忚偐銈撮柡鍛箞閹偤宕楅懖鈺冾啎闂佸湱鍋撳娆撴倿瑜版帗鐓曢悗锝庡亝瀹曞矂鏌?闂?闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煟閵忋埄鐒剧紒鎰殜閺岀喖骞嶉纰辨毉闂佺顑戠换婵嗩嚕閸洖閱囨慨姗嗗幗閻濇牜绱撴担鎻掍壕婵犵數濮撮崐鍫曞焵椤掍礁绗掓い顐ｇ箞閺佹劙宕ㄩ鈧ˉ姘舵⒑?
      row.isLocked = ContractRowLockStatus.UNLOCKED;
      row.lockReason = null;
    } else {
      // 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煟閵忋埄鐒剧痪鎯ь煼閺岋綁骞囬鑺ユ瘎闂佹椿鍘介悷鈺呭蓟閻旇　鍋撻悽娈跨劸濞寸姍鍥ㄢ拻闁告洦鍋勯顓㈡煛瀹€瀣瘈鐎规洘锕㈡俊鎼佸Ψ閵忕姳澹曢梺鐓庮潟閸婃绋夊澶嬬厸闁稿本渚楅崕銉╂煟閺傛寧顥㈤柟顔肩秺瀹曨偊宕熼浣稿壍婵＄偑鍊х€靛矂宕滈悢鐓庤摕婵炴垶鍩冮崑鎾绘晲鎼粹€茬凹闁诲繐娴氶崣鍐蓟瀹ュ瀵犲鑸瞪戠瑧闂備礁鐤囬褏绮旇ぐ鎺嬧偓浣肝熷▎鐐ㄧ紓鍌欓檷閸斿矂鈥﹂悜钘夎摕?闂?闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煟閵忋埄鐒剧痪鎯ь煼閺岋綁骞囬鑺ユ瘎闂佹椿鍘介悷鈺呮偂椤愶箑鐐婇柕濞р偓濡插牏绱掗悙顒€鍔ゆ繛灏栤偓鎰佸殨闁割偅娲栭柋鍥ㄦ叏濮楀棗骞楅柣婵囩墱缁辨挻鎷呴幓鎺嶅濠电姷鏁告慨瀵糕偓姘€鍥х；闁规崘宕靛畵渚€鏌涢…鎴濇灈濠殿喖楠搁—鍐Χ韫囨洜绐楅梺鍛婎殔閸熷潡顢氶敐澶婅摕闁靛鍠楅弲銏ゆ⒑閸涘﹥澶勯柛鎾寸洴瀹曘垽宕￠悜鍡樺瘜闂侀潧鐗嗗Λ妤佹叏瑜忕槐鎺楁嚑閼哥數銆婄紓渚囧枛椤兘鐛Ο鑲╃＜婵☆垳鍘ч獮妤呮⒒婵犲骸浜滄繛灞傚€濋、鏍川閺夋垹顦┑顔筋焾閸╂牠鎮￠崘顔藉仭婵炲棗绻愰鈺呮煟韫囨挾鎽犻柕鍥у婵偓闁挎稑瀚崳顕€姊洪崫銉バ㈤柨鏇ㄤ簻閻ｇ兘鏁撻悩鍐测偓鐑芥煙缂佹ê淇俊顐㈢墦濮?0闂?
      const contract = await this.contractRepo.findOne({
        where: { id: dto.contractId, isDeleted: SoftDeleteFlag.NOT_DELETED },
      });
      if (!contract) {
        throw new NotFoundException('Contract #' + dto.contractId + ' not found or deleted');
      }

      row = this.contractRowRepo.create({
        packageId,
        contractId: dto.contractId,
        contractCodeSnapshot: contract.contractCode,
        contractNameSnapshot: contract.contractName,
        cityAllocationId: allocation.id,
        monthNo: dto.monthNo,
        completionAmount: 0,
        acceptanceAmount: 0,
        invoiceAmount: null,
        orderAmount: null,
        isLocked: ContractRowLockStatus.UNLOCKED,
        lockReason: null,
      });
    }

    await this.contractRowRepo.save(row);

    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId: user?.userId ?? 0,
        actionType: 'admin_open_contract',
        targetType: 'contract_month_row',
        targetId: String(row.id),
        summaryText: 'Admin opened contract #' + dto.contractId + ' for package #' + packageId + ' (city ' + pkg.cityId + ', year ' + pkg.reportYear + ', month ' + dto.monthNo + ')',
        resultStatus: 'success',
      }),
    );

    return {
      success: true,
      message: 'Contract #' + dto.contractId + ' opened for month ' + dto.monthNo,
    };
  }

  // ============================================================
  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋涢ˇ鐢稿极閹剧粯鍋愰柤纰卞墻濡茬兘姊绘担鍛婃儓婵炲眰鍨藉畷褰掑捶椤撶姳绗夐梺缁橆焾濞呮洟宕ｈ箛鏂剧箚闁绘劙顤傞崵娆徝瑰鍫㈢暫闁诡喗顨堥幉鎾礋椤掑偆妲版繝鐢靛仩鐏忔瑩宕伴弽顓熷仒妞ゆ梻鈷堝銊╂煃瑜滈崜鐔煎Υ娴ｇ硶鏋庨柟鎯х－椤ρ呯磼閻愵剙顎滃瀛樻倐钘熼柕鍫濐槹閳锋帒霉閿濆牊顥夐柛姘秺閺屾盯鎮╅崘鎻掝潚闂佽鍠氶崗妯讳繆閻ゎ垼妲烽梺绋款儐閹告悂锝炲┑瀣亗閹兼番鍨昏ぐ搴♀攽?
  // ============================================================

  /**
   * 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕閵堝懎顏柡灞剧洴椤㈡洟鏁愰崱娆樻К缂傚倷鐒﹂崝鏍€冮崼銉ョ劦妞ゆ巻鍋撶紒鐘茬Ч瀹曟洟宕￠悘缁樻そ婵℃悂鍩℃担渚敤婵犳鍠楅…鍫ュ春閺嶎厼纾归柣銏犳啞閳锋帡鏌涢銈呮灁闁愁垱娲熼弻鐔煎箵閹烘挻鍠愰梺姹囧労娴滎亪鐛崱姘兼Ч闂佺顑冮崹浠嬪蓟閿濆绠奸柛鎰╁妺閸犲﹪鎮楃憴鍕闁绘牕鍚嬫穱濠傤潰瀹€濠冾€囬梻浣告惈濡鎹㈠┑鍡╂綎闁惧繐婀遍惌娆撴煕瑜庨〃蹇涘焵椤掍緡娈曢柕鍥у閺佸倿鎸婃径妯活棆闂備胶鎳撶粻宥夊垂瑜版帒鐓″鑸靛姇椤懘鏌ｅΟ鍏兼毈闁绘稒鎹囧缁樻媴缁涘缍堥梺璇″灠閻倸鐣烽姀锛勯檮缂佸娉曢ˇ顓㈡⒑鐟欏嫬鍔跺┑顔哄€濋崺娑㈠箣濠㈡繂缍婂畷妤呮嚃閳哄倸娅橀梻浣告啞鐢偞鏅跺Δ鍛﹂柛鏇ㄥ灱閺佸洭鏌ｉ幇顒€绾ф禍娑㈡⒒娴ｉ涓茬紒韫矙瀹曟煡鎳犻崜浣风胺闂傚倷绀侀幉锛勫垝閸儲鍊块柨鏇炲€搁悿楣冩煏韫囧鈧牠鍩涢幋锔解拺妞ゆ劑鍊曟禒婊堟煠濞茶鐏￠柡鍛埣閹囧醇濠婂懐鐣鹃梻浣告啞閻熴儵藝椤栨稒鍙忕€广儱顦伴悡鏇㈡煏婵炵偓娅囬柣锝囧劋椤ㄣ儵鎮欓崣澶婎槱闂佺懓鍢查幊妯虹暦閵婏妇绡€閹肩补鍓濋崑鎴︽⒒閸屾艾鈧悂宕愭搴ｇ焼濞撴埃鍋撴鐐寸墵椤㈡洟鍩涘顓熴仢濠碘剝鎮傞崺鈩冩媴閾忕懓鐐婇梻鍌欑濠€杈ㄦ櫠濡も偓椤灝螣閼测晙绗?
   *
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸ゅ嫰鏌涢锝嗙５闁逞屽墾缁犳挸鐣烽悡搴唵婵犻潧鐗婇崵鈧銈庡亝缁诲嫰骞戦崟顖涙優閻犲洠鍓濊倴婵犵數濮烽弫鎼佸磻濞戞娑樷枎閹惧啿鐎梺鍓插亝濞测晝绱為弽顓熺厸闁搞儯鍎遍悘顏堟煟閹惧崬鍔﹂柡宀嬬秮瀵剟骞愭惔銏犲壍闁诲孩绋掔换鍫濐潖閸濆娊铏规嫚閹绘帞顔戞俊鐐€戦崝宀勬晝椤忓嫷鍤曞┑鐘宠壘鎯熼梺闈涱槶閸ㄦ椽寮埀顒勬⒒娴ｈ櫣銆婇柛鎾寸箞閺佸鈹戦悙鍙夊暁闁告侗鍨抽敍婵囩箾鏉堝墽鎮奸柟铏尰閹便劍寰勯幇顓犲幈闁诲函绲婚崝宀勫焵椤掍胶绠撴い?
   * - completionTotal = sum(contractRows.completionAmount)
   * - acceptanceTotal = sum(contractRows.acceptanceAmount)
   * - costTotal = sum(costRows.amount)
   * - orderGrossProfit = sum(contractRow.completionAmount 闂?allocation.rate)
   * - grossProfit = orderGrossProfit闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弮鍫熸殰闁稿鎸剧划顓炩槈濡娅ч梺娲诲幗閻熲晠寮婚悢鍛婄秶濡わ絽鍟宥夋⒑缁嬫鍎忔い鎴濐樀瀵鈽夊Ο閿嬵潔闂佸憡顨堥崑鐔哥椤撱垺鍊甸悷娆忓缁€鈧悗娈垮枛閻栧ジ鐛崼銉ノ╅柕澶婃捣閸犳牕鐣疯ぐ鎺濇晩闁诡垎鍐窗闂傚倸鍊烽懗鍫曗€﹂崼銉晞闁稿瞼鍋涢悿鐐節婵犲倹鍣虹€规洖寮剁换娑㈠箣濞嗗繒浠煎Δ鐘靛亼閸ㄧ儤绌辨繝鍥舵晬婵﹩鍘介崕鎾愁渻閵堝骸浜滅紒澶屾嚀椤繐煤椤忓嫮顔囬柟鑹版彧缁插搫危閸繍娓婚柕鍫濇閻忋儲銇勯敂鐐毈闁绘侗鍣ｅ畷姗€濡告惔銏☆棃闁糕斁鍋撳銈嗗笒鐎氼剟鎮￠垾鎰佺唵閻犲搫褰块崼銉ュ嚑閹兼惌婢€缁诲棙銇勯弽銊х畵闁告艾缍婇弻锟犲幢椤撱垺顎嶆繛锝呮搐閿曨亪骞冨▎鎿冩晜闁告洏鍔屾禍楣冩煛瀹ュ骸骞栭柦鍐枛閺屾洘绻涢悙顒佺彆闂佺瀛╅〃濠囧蓟濞戞矮娌柣鎰靛墰濞堛倝姊洪崫鍕紨缂佺姵鎹囧濠氬即閻旈绐為梺鍓插亝缁诲倹鎱ㄩ崼鏇熲拺闁告稑锕ㄦ竟妯汇亜閹存繍妯€闁诡噯绻濋、鏇㈡晝閳ь剟鎮欐繝鍥ㄧ厪濠电姴绻愰々顒併亜閿旇骞栨い顏勫暣婵℃儼绠涢幘鑸敌掗梻渚€娼荤紞鍥╁緤娴犲缍栭煫鍥ㄧ⊕閹偤鏌涢敂璇插箻闁绘挻鎹囧娲川婵犲嫬顥夌紓浣虹帛缁诲嫬鈻庨姀銈呯妞ゆ棁袙閹疯櫣绱撴担鍓插剱妞ゆ垶鐟╁畷鏇㈠箛閻楀牏鍘遍梺鍝勫暊閸嬫捇鏌ｉ悢鍙夋珚闁绘侗鍣ｅ畷姗€鈥︾€ｎ偅銇濇い銏℃瀹曠喖顢樿閹牓姊婚崒娆掑厡缂侇噮鍨跺畷婵嬪冀椤撗勬櫓闂佸搫绋侀悘鎰洪鍕啇婵炶揪绲藉﹢閬嶅储閻㈠憡鈷戠紒瀣硶缁犳椽鏌涚€ｎ偄濮嶇€殿喖鍟块～婊堝焵椤掑嫬钃熸繛鎴欏灩鎯熼梺鎸庢煥椤洘绂掗姀銈嗏拺閻犲洠鈧櫕鐝紓浣虹帛缁诲牆鐣峰ú顏勭劦妞ゆ帊闄嶆禍婊堟煙閻戞ê鐏ユい蹇ｄ邯閺屽秹鏌ㄧ€ｎ亞浼岄梺鍝勬湰缁嬫垿鍩ユ径濠庢建闁割偅绻傞～鐘绘⒒娴ｄ警鏀版繛鍛礀鐓ゆ繝濠傛噺椤洟鏌熼悜姗嗘畷闁搞倖鍨堕妵鍕箳瀹ュ洤濡介梺缁樼箥娴滄粓鍩為幋锔藉€烽柛娆忣樈濡垿姊洪幖鐐插缂侇喗鐟╅悰顕€宕橀妸銏＄€婚梺鍦亾濞兼瑩鍩€椤掑倻甯涘ǎ鍥э躬椤㈡稑顭ㄩ崨顓狀偧闂?
   * - costRate = costTotal / completionTotal
   * - costIncomeRate = costTotal / orderGrossProfit
   * - netProfit = orderGrossProfit - costTotal
   * - netProfitRate = netProfit / completionTotal
   *
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻娑樷攽閸曨偄濮夐梺绋款儐閹告悂锝炲┑瀣ㄩ柕澶堝労濞煎酣鏌ｆ惔銈庢綈婵炲弶锕㈠畷婵嗏枎韫囷絽娈ㄦ繛瀵稿Т椤戞劙寮崘顔界叆婵犻潧妫欓崳瑙勵殽閻愭潙鐏存慨濠勭帛閹峰懘宕崟顐＄帛闂備胶顢婃慨銈囧垝閹炬剚鍤曟い鎰剁畱缁犵懓霉閿濆懏鎲搁柛妯绘尦閹鐛崹顔煎濠碘槅鍋呯粙鎾愁嚕瑜旈崺鈧い鎺戝閳锋帡鏌涚仦鐐殤濠⒀勭〒缁辨帞鈧綆鍋勫ù顔筋殽閻愬澧垫鐐叉喘椤㈡瑩鎸婃径澶岀梾濠电姵顔栭崰妤呭Φ濞戙垹纾婚柟鎯х摠閸欏繐鈹戦悩鎻掓殲闁靛洦绻冮〃銉╂倷閺夋垵顫嶉梺璇″灡濡啴寮幇鏉跨＜婵ê鍚嬬紞瀣⒒閸屾艾鈧兘鎳楅崼鏇炲偍鐟滃繒妲愰悙瀵哥瘈闁告洦鍘虹粭澶愭⒑閸濆嫯鐧侀柛娑卞枟椤旀洟姊洪懡銈呮瀾闁荤喆鍎抽埀顒佸嚬閸欏啫鐣烽弴銏″亜闁稿繗鍋愰崢鎾绘煛婢跺﹦澧戦柛鏂跨灱缁厼顫濋懜闈涗缓濡炪倖鐗楃粙鎴澝归濮愪簻闁靛繆鍩勯幋鐘电处闁伙絽鐬奸惌娆撴偣娓氼垳鍘涙俊鑼额潐娣囧﹪鎮欓鍕ㄥ亾閺嵮屾綎濠电姵纰嶉幆鐐哄箹缁懓鐏?0 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏℃櫇闁逞屽墴閹潡顢欐慨鎰盎闂佸搫绋侀崑鍕濠婂懐妫柟顖嗗嫬浠撮梺鍝勮閸婃洟婀侀柣搴秵閸嬪懘鎮甸弴銏″€甸悷娆忓缁€鍐煟閹垮嫮绡€鐎殿喖顭烽幃銏ゅ川婵犲嫮肖闂備礁鎲￠幐鍡涘川椤旂瓔鍟呴梻?0闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弮鍫熸殰闁稿鎸剧划顓炩槈濡娅ч梺娲诲幗閻熲晠寮婚悢琛″亾閻㈡鐒惧ù鐘欏洦鈷掗柛鏇ㄥ亜椤忣參鏌″畝瀣瘈鐎规洘锕㈡俊鎼佸Ψ閵忕姳澹曢梺鐓庮潟閸婃绋夊澶嬬厸闁稿本渚楅崕銉╂煟閺傛寧顥㈤柟顔款潐濞碱亪骞忓畝濠傚Τ闂備胶顭堢€涒晠宕濋弴銏＄畳婵犵數濮嶉崘顏冭檸闂侀€炲苯澧紒璇茬墕椤曪絾绻濆顓熸闂佺粯顭堢亸娆撴晬濠婂啠鏀介柣鎰綑閻忥箓鏌ㄩ弴妤佹珚鐎规洜鏁搁埀顒婄秵閸撴稓澹曢挊澹濆綊鏁愰崱妤冪シ婵炲瓨绮撶粻鏍ь潖?NaN / Infinity
   *
   * allocation.rate 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犖ч柛鈩冦仦缁剝淇婇悙顏勨偓鏍礉瑜忕划濠氬箣閻樺樊妫滈梺绉嗗嫷娈曢柣鎾寸懅缁辨挻鎷呴棃娑氫患濠电偛鎳忛敃銏ゅ蓟閳╁啯濯撮柛鎾村絻閸撹鲸绻涢敐鍛悙闁挎洦浜濇穱濠囧醇閺囩偛绐涘銈嗘尵閸犳劙顢欐径鎰拻濞达絽鎲￠幉绋库攽椤旇姤缍戦摶鐐寸節闂堟侗鍎忛柦鍐枑缁绘盯骞嬪▎蹇曚患闂佸憡顨嗘繛濠囧蓟閺囩喓绠鹃柛顭戝枛婵秶绱撴担闈涘妞ゎ厼鍢查～蹇涙惞鐟欏嫬鐝伴梺鑲┾拡閸撴盯顢欐繝鍥ㄢ拺闁告縿鍎辨牎闂佺粯顨堟慨鎾敋?
   *   allocation.cityId = package.cityId
   *   allocation.contractId = row.contractId
   */
  private async calculateBusinessSummary(
    packageId: number,
    monthNo: number,
    contractRows: { contractId: number; completionAmount: number; acceptanceAmount: number }[],
    costRows: { amount: number }[],
  ): Promise<{
    completionTotal: number;
    acceptanceTotal: number;
    costTotal: number;
    orderGrossProfit: number;
    grossProfit: number;
    costRate: number;
    costIncomeRate: number;
    netProfit: number;
    netProfitRate: number;
  }> {
    const pkg = await this.findPackageOrThrow(packageId);

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞妞ゆ巻鍋撴潻婵嬫⒑闁偛鑻晶鎾煛鐏炲墽銆掗柍褜鍓ㄧ紞鍡涘磻閸涱厾鏆︾€光偓閸曨剛鍘搁柣蹇曞仜婢ц棄煤鐎涙ǜ浜滈柕蹇婂墲缁€瀣煛娴ｇ懓濮嶇€规洖宕埢搴∥熼幁宥囧仱濮婂宕掑▎鎰偘婵犮垻鎳撻悧蹇旂缁嬪簱鏋庨柟閭﹀枤椤旀洟姊洪柅鐐茶嫰婢ф挳鏌＄仦绯曞亾瀹曞洦娈曢梺閫炲苯澧寸€规洑鍗抽獮妯兼嫚閼碱剛宕跺┑鐘垫暩婵瓨瀵奸敐澶嬪亜闁告稑锕ら～锟犳⒑閸濆嫷妲规い鎴炵懃铻炴繝濠傜墛閳?contractId
    const contractIds = contractRows.map((r) => Number(r.contractId)).filter((id) => id > 0);

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗霉閿濆牊顏犵紒鈧繝鍌楁斀闁绘ɑ褰冩禍鐐烘煟閹烘梹娅曢柟鍙夌摃缁犳盯寮撮悤浣圭稐闂備胶绮崝鏇㈩敋椤撶姴濮柍褜鍓熷娲箹閻愭彃濡ч梺鎼炲労閻撳妲愰鈧埞鎴︽偐閸偅姣勯梺绋款儐缁嬫垼鐏掓繝鐢靛Т閸熶即銆呴崣澶岀瘈濠电姴鍊绘晶娑㈡倵濮橆剚鍤囬柡宀嬬秮瀵剟宕归钘夆偓顖炴⒑缂佹ɑ灏紒缁樺姍閳ワ箓宕稿Δ浣告疂濠电偛鐗愬▔鏇㈠礉閻戣姤鈷戦柛娑橆焵閹达附鍎庢い鏍仜閽?allocation闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弮鍫熸殰闁稿鎸剧划顓炩槈濡娅ч梺娲诲幗閻熲晠寮婚悢琛″亾濞戞瑯鐒界紒鐘劦閺岋綁骞掗弮鈧▍鏇㈡煃瑜滈崜娑㈠磻閿濆纾规俊銈呭暙椤ユ岸鏌ｅ☉妯哄壉d + contractId闂?
    const allocations = contractIds.length > 0
      ? await this.allocationRepo.find({
          where: {
            cityId: pkg.cityId,
            contractId: In(contractIds),
          },
        })
      : [];
    const allocMap = new Map(allocations.map((a) => [Number(a.contractId), a]));

    const completionTotal = contractRows.reduce((s, r) => s + Number(r.completionAmount || 0), 0);
    const acceptanceTotal = contractRows.reduce((s, r) => s + Number(r.acceptanceAmount || 0), 0);
    const costTotal = costRows.reduce((s, r) => s + Number(r.amount || 0), 0);

    // 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箻閺岀喖骞嗛弶鍟冩捇鏌嶉柨瀣拻闁逞屽墮缁犲秹宕曢柆宓ュ洭顢涢悙鎻掔€梺绋跨灱閸嬬偤鎮￠悢鍏肩厽闁哄啫鍋嗛悞鐐亜閵夈儺鍎旈柡宀嬬節瀹曢亶顢橀悩鍨闂備礁鎼惌澶岀礊娴ｅ壊鍤曟い鏇楀亾闁糕斁鍋撳銈嗗笒鐎氼剚瀵奸悩宕囩鐎瑰壊鍠曠花鑽ょ磼閻樺啿鈻曢柡宀€鍠撻埀顒佺⊕钃遍柍閿嬪姈閵囧嫰顢曢姀鈶裤垽鏌嶇憴鍕伌闁糕斂鍎靛畷鍗炍旈崘褎妯婂┑鐘垫暩閸嬫盯骞忛幋鐘电濞达絽鎽滈弳?= sum(completionAmount 闂?allocation.rate)
    let orderGrossProfit = 0;
    for (const row of contractRows) {
      const contractId = Number(row.contractId);
      const alloc = allocMap.get(contractId);
      if (!alloc) {
        throw new BadRequestException('Contract #' + contractId + ' has no allocation rate configured');
      }
      orderGrossProfit += Number(row.completionAmount || 0) * Number(alloc.rate);
    }

    const grossProfit = orderGrossProfit; // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧潡鏌熺€电孝缂佽翰鍊濋弻锕€螣娓氼垱锛嗗┑鐐叉▕娴滄繈寮插鍫熺厽闁逛即娼ф晶顕€骞栭弶鎴含婵﹥妞藉畷銊︾節閸愵煈妲遍梻浣规偠閸斿秴顭垮Ο缁樻珡闂備礁鎼悮顐﹀磿閺屻儲鍋傞柛鎰典簼閸犳劖绻濇繝鍌滃缂佲偓閸儲鐓熼柡鍐ㄥ€哥敮鍫曟煢閸愵亜鏋涢柡灞诲姂閹垽宕崟鎴欏灮缁辨帡鍩€椤掑嫬绀冩い鏃傛櫕閸橀亶姊洪崫鍕偍闁告柨鏈粋宥咁煥閸喓鍘搁梺绯曞墲閻熴儵寮稿☉銏＄厸鐎光偓閳ь剟宕伴弽顓炵畺闁告挆鍌涘媰闂佸吋浜介崕鎶藉焵椤掆偓婢х晫妲愰幘瀛樺闁惧繒鎳撶粭锟犳⒑閻戔晜娅撻柛銊ゅ嵆閹箖鏌ㄧ€ｎ剟妾紓浣割儓椤曟娊濡搁埡鍌滃弳闂佸搫鍊告晶浠嬫儗濞嗘挻鐓涘〒姘矗闁垱鎱ㄦ繝鍕笡闁瑰嘲鎳愮划鐢碘偓锝庝簼閻ｄ即姊绘担鍛婃喐濠殿喚鏁婚妴鍐川椤栨艾鐤鹃梻鍌欒兌缁垰顫忔繝姘偍鐟滄柨顕ｉ崨濠冨閻炴稈鈧厖澹曞Δ鐘靛仜閻忔繈宕濆顓犵閻犲泧鍛煂闂佸疇顔婄划娆撱€侀弮鍫濋唶闁绘棁娓归悽缁樼節閻㈤潧浠滄俊顐ｇ懇閹柉顦圭€规洘宀稿璺何涢悽鍨殌妞ゎ厹鍔戝畷濂稿閵忊剝鐦掗梻鍌欑閹碱偆鎮锕€纾归柡鍥ュ灪缁犳帡姊虹拠鎻掑毐缂傚秴妫濆畷鎴﹀川鐎涙ê浠ч梺鍝勭▉閸樹粙鍩涢幋鐘垫／妞ゆ挾鍋為崳鐟懊瑰鍐Ш闁哄本绋戣灒闁绘ê寮舵径鍕磼閻樺啿绗氱紒缁樼箞閹粙妫冨ù韬插灲閺屻劑寮村Ο琛″亾濠靛棛鏆︽い鏍剱閺佸啴鏌ㄩ弮鍌滃笡闁哄懌鍨藉娲濞戞氨鐤勯梺绋匡攻閻楃娀骞冮垾鏂ユ闁靛繆鈧枼鍋撻崼鏇熺厽闁归偊鍓涢幗鐘绘煟韫囷絽娅嶆俊顐㈡嚇椤㈡寰勬繝鍌ゆ骄闂備線鈧偛鑻晶鍙夈亜椤愩埄妲搁悡銈夋煃閸濆嫬鏆熺紒鈧繝鍌樷偓鎺戭潩閿濆懍澹曢柣搴㈩問閸ｎ噣宕戞繝鍥╁祦闁搞儺鍓欑痪褔鏌涢…鎴濇灓闁绘稈鏅滄穱濠囨倷椤忓嫧鍋撻弽顓熷亱婵°倕鍟崹婵嬪箹鏉堝墽纾块柡?

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻娑樷攽閸曨偄濮夐梺绋款儐閹告悂锝炲┑瀣ㄩ柕澶堝労濞煎酣鏌ｆ惔銈庢綈婵炲弶锕㈠畷婵嗏枎韫囷絽娈ㄦ繛瀵稿Т椤戞劙寮崘顔界叆婵犻潧妫欓崳瑙勵殽閻愭潙鐏存慨濠勭帛閹峰懘宕崟顐＄帛闂備胶顢婃慨銈囧垝閹炬剚鍤曟い鎰剁畱缁犵懓霉閿濆懏鎲搁柛妯绘尦閹鐛崹顔煎濠碘槅鍋呯粙鎾愁嚕瑜旈崺鈧い鎺戝閳锋帡鏌涚仦鐐殤濠⒀勭〒缁辨帞鈧綆鍋勫ù顔筋殽閻愬澧垫鐐叉喘椤㈡瑩鎸婃径澶岀梾濠电姵顔栭崰妤呭Φ濞戙垹纾婚柟鎯х摠閸欏繐鈹戦悩鎻掓殲闁靛洦绻冮〃銉╂倷閺夋垵顫嶉梺璇″灡濡啴寮幇鏉跨＜婵ê鍚嬬紞瀣⒒閸屾艾鈧兘鎳楅崼鏇炲偍鐟滃繒妲愰悙瀵哥瘈闁告洦鍘虹粭澶愭⒑閸濆嫯鐧侀柛娑卞枟椤旀洟姊洪懡銈呮瀾闁荤喆鍎抽埀顒佸嚬閸欏啫鐣烽弴銏″亜闁稿繗鍋愰崢鎾绘煛婢跺﹦澧戦柛鏂跨灱缁厼顫濋懜闈涗缓濡炪倖鐗楃粙鎴澝归濮愪簻闁靛繆鍩勯幋鐘电处闁伙絽鐬奸惌娆撴偣娓氼垳鍘涙俊鑼额潐娣囧﹪鎮欓鍕ㄥ亾閺嵮屾綎濠电姵纰嶉幆鐐哄箹缁懓鐏?0 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋涢ˇ鐢稿极瀹ュ绀嬫い鎺嶇劍椤斿洦绻濆閿嬫緲閳ь剚娲熼獮濠呯疀濞戞锛涢梺璺ㄥ枔婵敻鎮¤箛鎾斀闁绘劖鍨甸崯顐︻敂閳哄懎绠归柡澶嬪煀闊剚鎱ㄦ繝鍛仩婵炴垹鏁诲畷銊╊敊閸忓ジ鏁紓鍌氬€烽懗鑸垫叏閻㈢鍨傞柛褎顨呯粻?0
    const profitMetrics = calculateProfitMetrics(completionTotal, costTotal, orderGrossProfit);
    const costRate = profitMetrics.costRate;
    const costIncomeRate = profitMetrics.costIncomeRate;
    const netProfit = profitMetrics.netProfit;

    const netProfitRate = profitMetrics.netProfitRate;

    return {
      completionTotal,
      acceptanceTotal,
      costTotal,
      orderGrossProfit,
      grossProfit,
      costRate,
      costIncomeRate,
      netProfit,
      netProfitRate,
    };
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊椤掑鏅悷婊冪Ч濠€渚€姊虹紒妯虹伇婵☆偄瀚划濠氭偐缂佹鍘甸梺璇″瀻閸愨晩鍟堥梻浣规偠閸庢椽宕滈敃鍌氭瀬鐎广儱顦伴悡鐔兼煙闁箑鐏犻柣銊︽そ閺岋綁骞橀弶鎴犱紝濠碘槅鍋勯幊姗€銆侀弴銏狀潊闁炽儲鍓氬Σ杈╃磽閸屾瑧顦︽い鎴濇瀹曞綊宕归鍛闂佸憡绋戦敃锕傛偡瑜版帗鐓冪憸婊堝礈閻斿鍤曞┑鐘宠壘閻掓椽鏌涢幇鈺佸缂佹劗鍋ら弻鐔煎礂閼测晜娈梺鎼炲妼椤攱淇婄€涙绡€闁搞儯鍔夐幏娲⒑闂堚晛鐦滈柛妯挎閳诲秹寮撮姀锛勫幈闂佺粯锚绾绢厽鏅堕鍛簻闁哄浂浜炵粔顔锯偓瑙勬礀閵堢顕ｉ幘顔藉亜閻忓繋绀佹禍鎯р攽閻樺磭顣查柣鎾存礋閺屽秹鍩℃担鍛婄亾濠电偛鐗婂褰掑Φ閸曨垼鏁冩い鎰剁節閸嬫姊虹拠鈥虫灍妞ゃ劌鐗撻獮澶愬箻椤旇偐顦板銈嗗笒閸嬪棗危娴煎瓨鈷掑ù锝堟鐢盯鏌熺喊鍗炰簽闁瑰箍鍨归埞鎴﹀幢閳轰焦顓挎俊鐐€栭崝鎴﹀春閸曨垰瑙﹂悗锝庡枟閻撴洘绻濇繛鎯т壕闂佺粯甯粻鎾崇暦閹剧粯顥堟繛鎴ｉ哺鐎靛矂姊洪棃娑氬婵☆偅鐟ф禍鎼佹偨閸涘﹦鍘遍柟鍏肩暘閸ㄨ鎱ㄥ鍥ｅ亾濞堝灝鏋熷┑鐐诧躬瀵偊骞樼紒妯轰汗闂佸搫鍊堕崕鑼偓姘偢濮婄粯鎷呴崨濠傛殘缂備浇顕ч崐濠氬焵椤掍礁鍤柛鐘愁殜瀵煡宕奸弴鐐插祮闂佺粯姊荤换婵堣姳婵犳碍鈷戦柟绋垮椤ュ棙銇勯弴鍡楁搐閸戠娀鏌曢崼婵愭Ч闁?JSON 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箻閺屸剝寰勭€ｎ亝顔呭┑鐐叉▕娴滄粓鎮″☉銏＄厱婵犲ň鍋撻柣鎺炵畵瀵煡顢旈崼鐔蜂画濠电姴锕ょ€氼剟鎮橀弶鎴旀斀闁挎稑瀚弳顒侇殽閻愬弶鍠樼€殿喖澧庨幑鍕Ω閵夈垹浜鹃柣鎰▕濞撳鏌曢崼婵囶棞缂佹鍊荤槐鎺楀焵椤掍胶鐟归柍褜鍓欓悾宄邦煥閸偅鏅ｉ梺闈涚箚濡狙囧箯濞差亝鈷戦柛娑橈功閳藉鏌ㄩ弴妯哄姕鐎垫澘瀚板畷鐔碱敍濞戞艾骞堥梻浣烘嚀婢т粙藟閹邦厾鐝舵慨妞诲亾闁哄苯绉剁槐鎺懳熺拠鑼紦闁诲氦顫夊ú鏍Χ缁嬫鍤曢柟缁㈠枟閸嬪嫰鎮樿箛搴ｎ槮濞存粓绠栭弻娑⑩€﹂幋婵呯敖缂備胶濞€缁犳牠寮婚悢琛″亾閻㈡鐒惧ù鐘欏洦鐓欓柧蹇ｅ亜婵牏绱掔紒妯兼创鐎规洖銈搁幃銏㈠寲閺囩喎顏虹紓鍌氬€峰ù鍥ㄣ仈閸濄儲鏆滈柨鐔哄Т缁犳牗绻濇繝鍌滃闁绘挻绋戦湁闁挎繂鎳庡Σ缁樸亜閵夛箒澹橀柍瑙勫灴閹晛鈻撻幐搴㈩唶缂傚倷娴囨ご绋棵洪悢椋庢殾闁硅揪绠戠粻锝夋煥閺囨浜剧紒鐐礃椤鎹㈠☉銏犵闁绘垵妫涢崝鐑芥⒑閸濆嫭锛旂紒鐘虫崌瀵鏁愭径濠庢綂闂侀潧鐗嗗Λ娆撴煥椤撱垺鈷戦柟鑲╁仜婵＄晫绱掔拠鑼ⅵ鐎殿喛顕ч鍏煎緞婵犲嫬骞愬┑鐐舵彧缁蹭粙骞夐垾鏂ユ灁闁告瑥顦辩粻楣冩倵濞戞顏勨枔閻樼粯鐓曞┑鐘插暟缁犵偟鈧鍠涢褔鍩ユ径鎰潊闁绘ɑ鐗撻崝宥夊Φ閸曨垰绫嶉柍褜鍓熷畷鏇炵暦閸ャ劍娈伴梺闈涱槴閺呮粓鍩涢幋锔界厱婵炴垶锕弨濠氭煟閹惧崬鍔﹂柡灞剧洴閹垽宕ㄦ繝鍌氭敪闁诲孩顔栭崰娑㈩敋瑜旈崺銉﹀緞閹邦剦娼婇梺缁樕戦鏍触閸涘瓨鈷掑ù锝囨嚀椤曟粎绱掔拠鎻掆偓鍧楃嵁婢跺ň妲堥柕蹇曞Х椤旀帞绱撻崒娆戝妽妞ゎ厼娲畷?
   * - 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎电濡介梺绋款儏椤戝鎮￠锕€鐐婇柕濞р偓濡插牏绱掗悙顒€鍔ゆい顓犲厴瀵鏁愭径濠勭杸濡炪倖甯婇悞锕傚磿閹炬枼鏀芥い鏃€顑欏鎰版煟閹垮嫮绡€鐎殿喖顭烽弫鎰緞婵犲嫮娼夐梻浣规偠閸庮垶宕曢鈧畷鎴﹀箻鐠囪尙鍔﹀銈嗗笒鐎氼參鎮?/ undefined / null / NaN / Infinity 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕閵堝懎顏柡灞剧洴椤㈡洟鏁愰崱娆樻К缂傚倷鐒﹂崝鏍€冮崼銉ョ劦妞ゆ巻鍋撶紒鐘茬Ч瀹曟洟宕￠悘缁樻そ婵℃悂鍩℃担渚敤婵犳鍠楅…鍫ュ春閺嶎厼纾归柛顭戝亞缁犻箖鏌熺€电鍓卞ù鐓庢閺岀喓鈧數顭堟禒褎銇勯埡鍌滃弨闁哄本娲熷畷鐓庘攽閹邦厜褔姊虹紒妯诲鞍闁烩晩鍨跺璇测槈濮橆偅鍕冮梺鍛婃寙閳ь剙危閸繍娓婚柕鍫濇缁€鍐磼椤斿吋鎹ｆ俊鍙夊姍楠炴帒螖閳ь剟鎮為崹顐犱簻闁圭儤鍨甸鈺呮煟?0
   */
  private toFiniteNumber(value: unknown): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亜顒㈡い鎰矙閺屻劑鎮㈤崫鍕戙垻鐥幑鎰靛殭妞ゎ厼娼￠幊婊堟濞戞鏇㈡⒑鏉炴壆顦︽い鎴濇喘楠炲骞栨担鍝ョ潉闂佸壊鍋呯换鍕偩閸濆嫧鏀介幒鎶藉磹閹捐埖顐介柍銉︾窞閿濆牄浜归柟鐑樺灩椤旀劙鏌ｆ惔銏⑩姇闁崇鍊濋、鏃堝川椤栵絾閿ゅ┑掳鍊х徊浠嬪疮椤栫偞鍋傞柣鏂垮悑閻撶喖鏌￠崘銊ヤ簽闁绘帞鍋撻妵鍕Ψ閵夘喖鍓板銈庡弨閸庡藝閾忣偆绠鹃柛娆忣槺閻帡鏌涢埞鎯т壕婵＄偑鍊栫敮鎺楀窗濮橆剦鐒介柟閭﹀幘缁犻箖鏌涘▎蹇ｆШ濠⒀囨涧閳规垿鍨惧畷鍥х厽濡ょ姷鍋為悧妤呭箯閸涙潙宸濆┑鐘插閸嬫捇顢楅崟顒€鈧灚顨ラ悙鑼虎闁告梹宀搁弻鐔风暋闁箑鍓板銈庡幖濞差參宕洪敓鐘茬＜婵☆垰婀遍惄搴ㄦ⒒娴ｇ儤鍤€闁圭⒈鍋勮灋婵°倓鑳堕々鎻捨旈敐鍛殲闁抽攱鍨块幃褰掑炊椤忓嫮姣㈢紓浣哄У閻擄繝寮婚敐澶婄闁告洦鍘鹃惁鍫ユ倵?unknown 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犖ч柛灞剧煯婢规洖鈹戦鐭亜鐣烽鍕偍閻庣數纭堕崑鎾舵喆閸曨剛顦銈庡亜椤﹂亶鍩€椤掑嫭娑ч柕鍫㈩焾椤曪綁宕奸弴鐐殿吅闂佺粯锚閻忔艾袙鎼淬垻绡€闁汇垽娼ф禒鈺呮煙濞茶绨界€垫澘锕幐濠冨緞濞戞壕鍋撻崸妤佲拺妞ゆ巻鍋撶紒澶嬫尦閹?SnapshotContractRowLike 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕婵犲倹鍋ラ柡灞诲姂瀵挳鎮欏ù瀣壕闁告縿鍎虫稉宥夋煛婢跺﹦姘ㄩ柡鈧禒瀣厽婵☆垵娅ｉ敍宥嗐亜閿濆棛鍙€闁?
   */
  private isSnapshotContractRowLike(value: unknown): value is SnapshotContractRowLike {
    return typeof value === 'object' && value !== null;
  }

  private isSnapshotCostRowLike(value: unknown): value is SnapshotCostRowLike {
    return typeof value === 'object' && value !== null;
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏℃櫇闁逞屽墴閹虫粏銇愰幒鎾跺幐闁诲繒鍋犻褔宕濆杈╃＜闁逞屽墴瀹曟﹢顢欓悾灞藉笚闂佸搫顦遍崑鐐寸珶閸℃稑绀夌€广儱娲ㄧ壕鍏间繆閵堝倸浜鹃梻浣稿簻缁蹭粙锝炶箛鏇犵＜婵☆垵顕ч鎾绘⒑閹呯闁硅櫕鎸剧划顓㈡晸閻樻枼鎷洪梺闈╁瘜閸欏酣鎮為悙顑跨箚妞ゆ劧绲跨粻鎾绘煟閿濆懎妲绘い顐ｇ矒閸┾偓妞ゆ帊妞掔换鍡涙煙闂傚鍔嶉柡鍛箞閺屽秷顧侀柛鎾跺枛瀹曟椽鍩€椤掍降浜滈柟鐑樺焾濡叉悂鏌ｈ箛銉х暤闁哄备鈧磭鏆嗛悗锝庡墰钃遍梻浣筋嚃閸ㄥ崬螞閸愵喖鏄ラ柛鏇ㄥ灠缁€鍐┿亜閹捐泛顎岄柡鈧妸銉㈡斀闁绘ê鐏氶弳鈺呮煕鐎ｎ偆娲存鐐诧工閻ｆ繈宕熼銏⑩偓顓㈡煟閻樺弶鎼愮€殿噮鍓熼弫鎰緞婵犲嫮鏉搁梻浣虹帛椤ㄥ懘鎮ч崱妯碱洸闂侇剙绉甸埛鎴︽煕閹炬潙绲诲ù婊勭墵閺屾盯鍩℃担鍓蹭患闂?contractRowsJson 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴鐐测偓鍝ョ不閺嶎厽鐓曟い鎰剁稻缁€鈧紒鐐劤濞硷繝寮婚悢鐓庣畾闁绘鐗滃Λ鍕磼閻愵剙鍔ゆい顓犲厴瀵鏁愭径濠冾棟闂佸壊鐓堥崰妤呭磹椤栫偞鈷?orderGrossProfit
   *
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴妤€浜惧銈庝簻閸熸潙鐣疯ぐ鎺濇晪闁告侗鍨版慨娲⒒娴ｄ警娼掗柛鏇炵仛閻ｅ墎绱撴担鎻掍壕婵犮垼鍩栭崝鏍磹閻㈠憡鐓ユ繝闈涙椤庢顭胯瑜板啴鍩為幋锔绘晩闁圭娴疯ぐ褔姊洪棃娑欐悙閻庢矮鍗抽悰顕€骞掑Δ鈧粻锝嗙節閸偄濮冪紒杈ㄥ灴閺岋絾鎯旈妶搴㈢秷闂佽鎮傞ˉ鎾斥枎閵忕媭娼╅悹娲細閹芥洟姊洪弬銉︽珔闁哥噥鍋嗗▎銏ゆ倷閻戞ê鈧敻鏌ㄥ┑鍡欏嚬缂併劏妫勯湁闁绘娅曠紞鎴炪亜椤忓嫬鏆ｅ┑鈥崇埣瀹曞崬螣閻撳骸姹查梻鍌欑劍鐎笛兠鸿箛娑樼？闁汇垹鎽滃畵渚€鏌涢鐘插姎閹喖姊洪崘鍙夋儓闁稿﹤鎲＄粋鎺楊敇閵忊檧鎷虹紓鍌欑劍閿曗晛鈻撻弮鍫熺厽婵°倐鍋撴俊顐ｇ箚濡喖姊洪崘鍙夋儓闁瑰啿绻橀崺娑㈠箣閿旇В鎷哄銈嗗姂閸婃洘绂掑鍫熺厾婵炶尪顕ч悘锟犳煛閸涱厾鍩ｇ€规洩绲惧鍕醇濠婂懐娉块梻鍌欑閹碱偊宕愰崫銉ょ剨闁告稑顕崣鏇熴亜閹烘垵顏柣鎾寸懇閺屟嗙疀閿濆懍绨介梺鐟板暱濞诧箓銆冮妷鈺傚€风€瑰壊鍠栭崜鍫曟⒑鏉炴壆顦﹂柛鐔告尦瀹曟椽鍩€椤掍降浜滈柟鐑樺灥閳ь剝宕垫禍鎼佹偨绾版ê浜炬鐐茬仢閸旀碍绻涚拠褏鐣电€规洑鍗抽獮鍥敊閻熼澹曞Δ鐘靛仜閻忔繈宕濆顓滀簻闁挎棁顕ч悘锝囩磼椤旂⒈鐓奸柟顔荤矙瀹曘劍绻濋崟顐㈢瑲闂傚倷绀侀幉锛勬崲閸屾壕鍋撳鐓庡籍鐎规洖鍟跨叅妞ゅ繐鎳愰崢閬嶆煟鎼搭垳绉靛ù婊勭矒閸┾偓妞ゆ巻鍋撴い顓犲厴閻涱喗寰勯幇顒€绐涙繝鐢靛Т閸燁偊宕濋崨瀛樷拺闂傚牊渚楅悡顓犵磼閻樺啿鐏寸€规洘绮撻弫鍐磼濞戞帗瀚奸梻浣告啞缁嬫垿鏁冮敃鍌氱厐闁哄洨鍠撶粻楣冩煕韫囨艾浜归柟鍐叉嚇閺?orderGrossProfit 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊椤掑鏅悷婊冪箻閸┾偓妞ゆ帊鑳堕埢鎾绘煛閸涱喚绠橀柛鎺撳笒閳诲酣骞樺畷鍥跺敽婵犵绱曢崑娑㈡儍閻戣棄纾婚柟鎹愵嚙缁€鍐┿亜閺冨倸甯堕柤鏉跨仢閳规垿鎮欓弶鎴犱紘婵＄偛鐡ㄩ幃鍌氼嚕閺屻儱鐓涢柛娑卞枛閳ь剛鏁婚弻娑滅疀閹垮啯笑婵炲瓨绮撶粻鏍ь潖濞差亜宸濆┑鐘插暙椤︹晠姊洪崨濠冨鞍闁荤啿鏅涢悾宄邦煥閸偅鏅ｉ梺闈涚箚濡狙囧箯濞差亝鈷戦柛娑橈功閳藉鏌ㄩ弴妯哄姕鐎垫澘瀚板畷鐔碱敍濞戞艾骞堥梻浣筋潐閸庢娊顢氶銏犵疇闁搞儮鏂侀崑鎾舵喆閸曨剛顦ㄧ紓渚囧枛缁夊爼鍩€椤戣法绁烽柛瀣姍閸┾偓妞ゆ帊鑳堕埊鏇熴亜椤撶偞鍠樼€规洏鍨介弻鍡楊吋閸″繑瀚奸柣鐔哥矌婢ф鏁幒鎾额洸濞寸厧鐡ㄩ悡鏇㈡煟濡櫣锛嶅褜鍓涚槐鎺楀磼濞戞ɑ璇炲銈冨灪閻╊垶骞冨▎鎴斿亾閻㈡鐒鹃悽?
   * 婵?contractRowsJson 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箻閺屸剝寰勭€ｎ亝顔呭┑鐐叉▕娴滄粓鎮″☉銏＄厱婵犲ň鍋撻柣鎺炵畵瀵煡顢旈崼鐔蜂画濠电姴锕ょ€氼剟鎮橀弶鎴旀斀?contractId + completionAmount闂?
   * 闂?package.cityId + contractId 闂?allocation.rate 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛濠傛健閺屻劑寮村鑸殿€栨繛瀛樼矊缂嶅﹪寮诲☉銏犵疀闁稿繐鎽滈弫鏍⒑濞茶骞楅柟鐟版喘瀵鏁愭径濠庢綂闂侀潧绻嗛弲婵嬪礉閹间焦鈷戦柦妯侯槸閺嗙喖鏌涢悩鏌ュ弰闁糕晝鍋ら獮瀣晜閽樺姹楅梻浣告贡缁垳鏁埡鍌滎浄闁绘劦鍓涚弧鈧┑鐐茬墕閻忔繈鎮橀悩缁樼厪闁割偆鍠愰崐鎰偓娈垮枛椤攱淇婇幖浣肝ㄩ柕蹇婃濞兼梹绻濈喊妯活潑闁割煈鍨抽幏鍐晜閽樺鍤ら梺閫炲苯澧存慨濠勭帛閹峰懘宕ㄦ繝鍐ㄥ壍婵犵妲呴崑鎺楀矗閸愩劎鏆︽繝濠傜墛閸嬪嫰鏌ｉ幘铏攭闁?
   *
   * 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磽娴ｅ搫鞋妞ゎ偄顦垫俊鐢稿礋椤栨氨鐤€闂佸憡鎸烽懗鍫曞汲閻樺厖绻?allocation 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏℃櫇闁逞屽墴閹潡顢欐慨鎰盎闂佸搫绉查崝搴ㄥ疮閺屻儲鐓犻柡澶嬪閸嬨儵鏌＄仦鍓ф创闁轰礁鍊婚幏鐘诲箵閹烘棏鍟嬬紓鍌氬€烽懗鑸垫叏閻㈢钃熼柕濞炬杹閳ь剨绠撳畷绋课旀担鍛婄杺闂傚倸鍊搁悧濠勭矙閹达讣缍栫€光偓閳ь剛妲愰幘瀛樺闁告繂瀚烽埀顒€鐭傞弻娑㈡偐閹颁焦鐣奸梺鐟扮畭閸ㄥ綊鍩ユ径鎰潊闁绘ɑ顔栭崥鍛節閻㈤潧浠滄俊顐ｎ殘閹广垽骞掗幘棰濇祫婵°倧绲介崯顖炲煕閹达附鐓曟繝闈涙椤忣亪鏌涢敐鍡椻枙闁哄矉绻濆畷銊╊敍濮橈絾鐎伴柣搴㈩問閸犳牠鈥﹂柨瀣╃箚闁归棿绀佸敮闂侀潧绻嗗Σ鍛焽閺冣偓缁绘繄鍠婂Ο娲绘綉闂佹悶鍔岀壕顓㈠礆閹烘鏁嶉柣鎰皺椤斿棝姊绘笟鍥у缂佸鏁婚幃?0 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繐霉閸忓吋缍戦柛銊ュ€块弻锝夊箻瀹曞洤鍝洪梺鍝勵儐閻楁鎹㈠☉銏犵闁绘劘灏欓崝浼存⒑缁嬫鍎愰柟鍛婃倐閿濈偛鈹戠€ｎ偄浜楅柟鍏肩暘閸ㄦ槒銇愭惔顫箚闁靛牆娲ゅ暩闂佺顑嗛惄顖氱暦椤栫儐鏁嶆繝濠傚鎼村﹤鈹戦悩缁樻锭妞ゆ垵鎳橀幃娆愮節閸ャ劎鍘繝鐢靛Т缁绘ê顬婇鈧弻锝呪攽閹邦兛鍠婂┑顔硷功缁垶骞忛崨顖滅煓婵炲棛鍋撻ˉ鎴︽⒒娴ｄ警鐒炬い鎴濇嚇楠炲﹪骞囬弶璺唹闂侀潧绻堥崐鏇犲閸忚偐绡€鐟滃酣宕曢搹顐ゎ洸濡わ絽鍟悡銉︾節闂堟稒顥滈柍褜鍓欓幉锛勭矉瀹ュ棎鍋呴柛鎰ㄦ杹閹风粯绻涙潏鍓у閻犫偓閿曞倸缁╅柡澶嬵儥閻斿棝鏌ｉ悢绋款棆濠⒀嶉檮椤ㄣ儵鎮欑€涙ê纾冲銈冨灪濡啫鐣锋總鍛婂亜闁告瑥顦惁閬嶆⒒閸屾瑧顦﹂柟娴嬧偓瓒佹椽鏁冮崒姘€梻渚囧墮缁夊澹曢崸妤佺厵閻庣數顭堟牎闂佸摜濮甸崝娆撳蓟閿濆憘鏃堝焵椤掑嫭鍋嬮柛鈩冪懅缁犳棃鏌熼悜妯烩拻缁炬儳銈搁弻锝呂熼崫鍕瘣闂佽绻戦幐鎶藉蓟閻旂⒈鏁婃繛鍡欏亾缂嶅牓姊洪悷鏉挎Щ闁硅櫕锚閻ｇ兘顢曢敃鈧敮濡炪倖鐗楃划搴ㄋ囬鐐粹拻闁稿本鐟︾粊鎵偓瑙勬礈閺佽鐣锋导鏉戠疀妞ゆ棁妫勬惔濠囨⒑閸撴彃浜栭柛搴″暱閻ｅ灚绗熼埀顒勫蓟閳ユ剚鍚嬮幖绮光偓鑼埍闂備胶顭堥鍡涘箰閹间礁鐓″璺号堥弸宥夋煣韫囷絽浜滈柣蹇旀尦閺岀喖顢氶崱娆戠槇婵犵绱曢崗姗€寮崒鐐茬鐟滄粓宕惔銊︹拻濞达絽鎲￠崯鐐烘煟閻旀潙鍔﹂挊婵嬫⒑椤掆偓缁夌敻宕曞Δ鍛厵闁绘垶蓱閻撴盯鏌涚€ｎ偅灏柍缁樻崌瀹曞綊顢欓悾灞借拫闂傚倷绀侀幗婊勬叏閻㈠憡鍎庢い鏍ㄧ箖椤ャ倝姊绘担绛嬫綈闁稿骸鍚嬮幈銊╁Χ婢跺浜楀┑鐐村灟閸ㄦ椽鎮￠弴銏＄厓闁宠桨绀侀弳鐔兼煙閸愭彃鏆ｉ柡宀嬬磿閳ь剨缍嗛崑鍡涘煀閺囩喆浜滈柕濠忕到閸旓箓鏌熼鐣屾噰鐎殿喖鐖奸獮瀣偐鏉堚晝顦繝纰夌磿閸嬫垿宕愰幋锕€鍨傛繛宸簼閸嬶繝鏌嶉崫鍕櫣缂佺姷濞€閺屸€愁吋鎼粹€崇闂佺粯鎸婚敃銏ゅ蓟閿濆绠涢梻鍫熺☉椤亜鈹戦悙鍙夊櫤闁绘娲熼崺鐐哄箣閿旇棄浜归梺鍓茬厛閸嬪懎袙閸曨剛绡€婵炲牆鐏濋弸娑氱磼婢跺本鍤€闁伙絽鍢查～婊堝焵椤掍椒绻嗛柟闂寸劍閺呮粓鏌涘▎宥呭姢闁活厽姘ㄧ槐鎾诲磼濮橆兘鍋撻幖浣哥９鐎瑰嫭鍣磋ぐ鎺戠倞闁靛绲肩划鎾剁磽娴ｅ壊鍎撴繛澶嬫礋瀵娊宕卞☉娆戝幈濠电偞鍨堕敃顐㈩潖濡ゅ啰纾?
   * 婵?calculateBusinessSummary 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧鏌ｉ幇顒佹儓闁搞劌鍊块弻娑㈩敃閿濆棛顦ョ紓浣哄С閸楁娊寮诲☉妯锋斀闁告洦鍋勬慨銏ゆ⒑濞茶骞楅柟鐟版喘瀵鎮㈤搹鍦紲闂侀潧绻掓慨鐢告倶閸垻纾藉ù锝呮惈鏍￠梺缁橆殘婵炩偓鐎殿喖顭烽幃銏ゆ偂鎼达綆鍞归梻渚€鈧稑宓嗘繛浣冲啠鏋旀い鎾卞灪閳锋垿鎮归崶顏勭毢缂佺姵褰冮埞鎴︽倷鐠囇嗗惈閻庢鍠栭…鐑藉极閹剧粯鍋愰柤纰卞墾缁卞弶绻濋悽闈涒枅婵炰匠鍛亾濮樷偓閸パ咃紱闂佽宕橀褔鎮為崹顐犱簻闁圭儤鍨甸顏堟煟閹惧瓨绀嬮柟顔筋殜閺佹劖鎯旈垾鑼嚬闁诲氦顫夊ú鏍儔婵傜鐒垫い鎺嶇贰閸熷繘鏌涢敐搴℃珝鐎规洘绮撻幃銏ゆ嚃閳轰胶銈﹂梻浣哥秺閸嬪﹪宕㈡禒瀣？闁绘柨鍚嬮悡鍐⒑濞嗘儳鐏犲ù婊堢畺濮婅櫣绮欏▎鎯у壉闂佸湱鎳撳ú顓㈢嵁閸愨晝顩烽悗锝庝簻缁愭稒绻濋悽闈浶㈤悗姘煎墴閻涱喖顫滈埀顒€顫忕紒妯诲闁告稑锕ラ崕鎾愁渻閵堝繘妾鐟版閸┾偓妞ゆ帒鍊婚幊妤呮煕閵夋垵娲﹂敍妤呮⒑閼姐倕鏋戦柣鐔村劤閳ь剚鍝庨崝宥囩矉瀹ュ拋鐓ラ柛顐ゅ枔閸樻悂姊洪幖鐐插姌闁稿氦椴告穱濠囧礂閼测晝顔曢梺鍛婁緱閸樻崘鍊撮梻渚€鈧偛鑻晶顖涖亜閺冣偓閻楃姴鐣烽幎绛嬫晪闁逞屽墮閻ｅ嘲顭ㄩ崼鐔蜂簻闂佺粯鎸稿ù鐑芥偩濞差亝鍋℃繝濠傚閻撱儵鏌ｉ敐鍥у幋闁诡喒鍓濋幆鏂课熺紒妯绘緫闂傚倷绀佹竟濠囧磻閸涱垳绱﹀Δ锝呭暙绾惧鏌熼幑鎰靛殭缂佺姵濞婇弻鐔煎箚瑜嶉。铏亜閺冣偓濞茬喖寮婚敐鍡樺劅闁靛繆鎳囨慨鍥⒑閹稿海顣茬紒缁樼洴瀹曞ジ濮€閻橆偅鐎伴梻浣告惈閺堫剛绮欓幒鏃€宕叉繝闈涱儏缁€鍐煃鏉炴媽鍏屾い锝呭级娣囧﹪鎮欓鍕ㄥ亾閺嶎灐娲煛閸愩劎绛忛梺绋匡功閸犳挻绂嶅▎鎾粹拻濞达絽鎲￠崯鐐层€掑顓ф疁鐎规洏鍨虹缓鐣岀矙閼愁垰鐓橀梻渚€娼ц墝闁哄懏绮撻崺娑㈠箣閻樼數锛滈柣搴秵閸樼晫娑甸崜浣虹＜闁绘ê鍟块埢鏇㈡煛鐏炲墽鈽夐摶锝夋煟濡搫绾х紒渚囧亞缁?400闂?
   */
  private async calculateSnapshotOrderGrossProfitFallback(
    pkg: AnnualPackageEntity,
    contractRowsJson: unknown,
  ): Promise<number> {
    if (!Array.isArray(contractRowsJson) || contractRowsJson.length === 0) {
      return 0;
    }

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弴妤€浜惧銈庝簻閸熸潙鐣疯ぐ鎺濇晪闁告侗鍨版慨娲⒒娴ｄ警娼掗柛鏇炵仛閻ｅ墎绱撴担鎻掍壕婵犮垼鍩栭崝鏇犵不瑜版帒绾ч柛顐ｇ箓閳锋梻绱掔€ｎ亶鐓奸柡灞剧〒閳ь剨缍嗛崑鍡樻櫠椤掑嫭鐓忛柛銉戝喚浼冨Δ鐘靛仜濞差厼鐣峰鍕闁绘垶蓱椤斿繘姊婚崒娆戝妽闁诡喖鐖煎畷婵嗙暆閸曨偆锛欓梺绉嗗嫷娈旂紒鐘崇墬娣囧﹪濡堕崨顔兼闂佸搫鎳忛悡锟犵嵁閺嶎偀鍋撳☉娆樼劷缂佺姵锕㈤弻鈩冩媴閸︻厼鈷屽┑顔硷攻濡炶棄鐣烽锕€绀嬫い鎺戭槹閿涗線姊绘担鍛婅础闁硅櫕鎸哥叅妞ゆ挾鍎愰崵鏇㈡偣閸ャ劎銈存俊鎻掔墛娣囧﹪顢涘☉姘辩厑濠殿喖锕ゅ﹢閬嶅箲閵忕姭鏀介悗锝庝簽閿涙粌鈹戦悙鍙夘棞缂佺粯鍔曡闁归偊鍠氱壕浠嬫煕鐏炴崘澹橀柍褜鍓欓崲鏌ユ箒闂佹悶鍎洪崜锕傚极鐎ｎ剚鍠愰柡鍌濇硶閺嗭附銇勯弽顐㈠壉闁轰礁鍟撮弻銊╁棘閸喖杈呴梺绋款儐閹瑰洭寮崘顔肩＜婵絽鐨烽弲鐘诲蓟瀹ュ棙濮滈柟娈垮枛椤曢亶鎮峰鍕棃鐎殿喛顕ч埥澶娢熼柨瀣垫綌闂備礁鎲￠〃鍫ュ磻濞戞氨涓嶆繛宸簼閳锋垵霉閸忚偐鎳囨俊缁㈠枟閹便劍绻濋崨顓炴優濠碘€冲级閸旀瑩鐛Ο鍏煎珰闁肩⒈鍓ㄧ槐鍙夌節閻㈤潧浠滄俊顐ｇ懇瀹曞綊宕归锛勭畾婵炲濮撮鍡涘煕閹达附鐓曢柨鏃囶嚙瀵箖鏌ｉ幒鏂夸壕闁靛洤瀚伴、姗€鎮╅幓鎺戠婵°倗濮烽崑娑㈠疮椤愩儳浜欓梻浣告啞缁牓鎮為敃鍌氱柧妞ゆ巻鍋撻柍瑙勫灴椤㈡瑩鎯岄顐￠偗鐎规洏鍎抽埀顒婄秵娴滆泛霉閺嶎厽鐓忓┑鐐靛亾濞呭棝鏌嶉柨瀣伌闁哄瞼鍠撶划娆撳箰鎼淬垹闂紓鍌欒兌婵敻骞愰懡銈嗗床婵炴垯鍨洪崵鎴炪亜閹哄棗浜鹃梺瀹狀嚙閻楁捇寮诲☉銏犵厴闁诡垎鍌氼棜婵犵绱曢崑鎴﹀磹閺嶎偅鏆滃┑鐘插椤愪粙鏌曢崼婵愭Ч闁搞倐鍋撻梻浣侯潒閸曞灚鐣烽梺缁樻尰閻燂箓濡甸崟顖氬唨闁靛鍔岄ˉ婵嬫⒑閸濆嫭锛旂紒鎻掓健閸┾偓妞ゆ帒鍠氬鎰箾閸欏鐭掔€规洑鍗冲浠嬵敇濠ф儳浜惧ù锝呭濞尖晠鎮归崫鍕儓缂佹劖绋戦—鍐Χ閸℃﹩姊挎繝娈垮枔閸婃洟鈥?
    const rows = contractRowsJson.filter((row): row is SnapshotContractRowLike =>
      this.isSnapshotContractRowLike(row),
    );

    if (rows.length === 0) return 0;

    const contractIds = rows
      .map((row) => Number(row.contractId))
      .filter((id) => Number.isFinite(id) && id > 0);

    const allocations = contractIds.length > 0
      ? await this.allocationRepo.find({
          where: {
            cityId: pkg.cityId,
            contractId: In(contractIds),
          },
        })
      : [];
    const allocMap = new Map(allocations.map((a) => [Number(a.contractId), a]));

    let total = 0;
    for (const row of rows) {
      const contractId = Number(row.contractId);
      if (!Number.isFinite(contractId) || contractId <= 0) continue;

      const completionAmount = this.toFiniteNumber(row.completionAmount);
      const alloc = allocMap.get(contractId);

      if (!alloc) {
        // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏℃櫇闁逞屽墴閹虫粏銇愰幒鎾跺幐闁诲繒鍋犻褔宕濆杈╃＜闁逞屽墴瀹曟﹢顢欓悾灞藉笚闂佸搫顦遍崑鐐寸珶閸℃稑绀夌€广儱娲ㄧ壕鍏间繆閵堝倸浜鹃梻浣稿簻缁蹭粙锝炶箛鏇犵＜婵☆垵顕ч鎾绘⒑閹呯闁硅櫕鎸剧划顓㈡晸閻樻枼鎷洪梺闈╁瘜閸欏酣鎮為悙顑跨箚妞ゆ劧绲跨粻鎾绘煟閿濆懎妲绘い顐ｇ矒閸┾偓妞ゆ帊妞掔换鍡涙煙闂傚鍔嶉柡鍛箞閺屽秷顧侀柛鎾跺枛瀹曟椽鍩€椤掍降浜滈柟鐑樺焾濡叉悂鏌ｈ箛銉х暤闁哄备鈧磭鏆嗛悗锝庡墰钃遍梻浣筋嚃閸ㄥ崬螞閸愵喖鏄ラ柛鏇ㄥ灠缁€鍐┿亜閹捐泛顎岄柡鈧妸銉㈡斀闁绘ê鐏氶弳鈺呮煕鐎ｎ偆娲存鐐诧工閻ｆ繈宕熼銏⑩偓顓㈡煟閻樺弶鎼愮€殿噮鍓熼弫鎰緞婵犲嫮鏉搁梻浣告惈椤﹀啿鈻旈弴銏╂晣闁绘挸瀵掑〒濠氭煏閸繃顥為柣鎾卞劚椤儻顦辩紒顔界懇瀵偄顓奸崨顏呮杸闁诲函缍嗛崑鈧柟閿嬫そ濮婃椽宕ㄦ繝鍕ㄦ闂佹寧娲╂俊鍥╁垝婵犳艾绠荤紓浣姑埀顒€鐏氶幈銊ノ熺粙鍨婵犵绱曢弲顐ゆ?allocation 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏℃櫇闁逞屽墴閹潡顢氶埀顒勫蓟閻旂厧绠氶柣妤€鐗滃Λ鍕⒑閸濆嫬顏ラ柛搴ｆ暬瀵鍨鹃幇浣告倯闁硅壈鎻徊鑲╁垝鐠鸿　鏀介柣鎰綑閻忕喖鏌涢妸褎鍤€婵炴彃娼″缁樻媴閸涘﹤鏆堟繛鎾寸椤ㄥ棛绮嬪鍛斀閻庯綆鍋勯埀顒€鐖奸弻娑㈠箛闂堟稒鐏嶉梺鎶芥敱閸ㄥ潡寮诲☉妯锋斀闁糕剝顨忔禒鍓х磽娴ｆ彃浜鹃悗鍏夊亾闁告洦鍓涢崢閬嶆⒑閸愬弶鎯堥柛濠傤煼閸╁﹪寮撮悩顐壕闁割煈鍋呯欢鏌ユ倵濮樼厧澧撮柟顔藉劤閳规垹鈧綆浜為崝锕€顪冮妶鍡楃瑐闁煎啿鐖奸崺銏ゅ籍閸屾浜炬鐐茬仢閸旀碍淇婇锝嗏拻闁瑰箍鍨藉畷鍗炩槈濞嗘垵甯鹃梻浣稿閸嬪懐鎹㈤崘鈺佸灁濠靛倸鎲￠悡鏇㈠箹濞ｎ剙鐏╅柣蹇婃櫇缁辨帗娼忛妸銉﹁癁闂佺硶鏂侀崑鎾愁渻閵堝棗绗傜紒鈧担鐑橆偨闁绘劗鍎ら悡娆撴⒑椤撱劎鐣辨鐐达耿閺?0 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繐霉閸忓吋缍戦柛銊ュ€块弻锝夊箻瀹曞洤鍝洪梺鍝勵儐閻楁鎹㈠☉銏犵闁绘劘灏欓崝浼存⒑缁嬫鍎愰柟鍛婃倐閿濈偛鈹戠€ｎ偄浜楅柟鍏肩暘閸ㄦ槒銇愭惔顫箚?
        // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏℃櫇闁逞屽墰婢规洟宕烽鐘碉紳婵炶揪缍€閸嬪倿骞嬪┑鍐╃€洪梺缁樏崢鏍崲閸℃稒鐓忛柛顐ｇ箖閸ｈ銇勮箛瀣姎闂囧绻濇繝鍌涘櫤闁搞倐鍋撻梻鍌氭搐椤︾敻寮婚妸銉㈡斀闁糕剝锚濞呫倝鏌ｉ悩鍐插闁告挻绻堟俊鐢稿礋椤栨氨鍘搁梺绋挎湰缁苯顕ｉ妸鈺傗拺闁告繂瀚﹢鐗堢箾閼碱剙鏋庨柣锝囧厴閹剝鎯斿Ο缁樻澑闂備焦鎮堕崕婊堝礋閸忓摜鏁剧紓鍌氬€搁崐鎼佸磹閻戣姤鈷旂€广儱顦粈澶屸偓骞垮劚閹虫劙寮抽崱娑欑厵闂傚倸顕ˇ锕傛煢閸愵亜鏋涢柡灞诲姂閹垽宕崟鎴欏灪娣囧﹪鎮欓懜娈挎闂傚洤顦甸弻銊モ攽閸℃ê娅ら梺纭呭皺椤牓婀侀梺缁樕戦悷銉╁箠閹邦喖顥氶柦妯侯棦瑜版帗鏅查柛顐亜濞堟劕鈹戦悙鑼婵﹤缍婃俊鐢稿礋椤栨稒娅嗛梺鑺ッˇ钘壩涢崱娑欌拺闂侇偆鍋涢懟顖涙櫠娴煎瓨鐓涘ù锝堫潐閸婃劗鈧娲忛崹濂杆囪ぐ鎺撶叆婵犻潧鐗嗘禒婊堟煃鐟欏嫬鐏寸€规洜鍘ч～婵嬵敄閸噮妫滈梻鍌欑窔濞艰崵鈧潧鐭傚畷銏ゅ礂閼测晛鈪伴梻浣筋嚙濮橈箓锝炴径鎰畺闁割偅娲栭崹鍌滄喐閻楀牆绗掗柣鎾达耿閺岀喐娼忛幆褏妲ｉ梺杞扮閿曨亪寮婚敐澶嬫櫜闁告侗鍨虫导鍥╃磽娴ｇ缍侀柛妤€鍟块～蹇涙惞閸︻厾鐓撻梺鍛婄墤閸撴繈寮幆褉鏀介柣鎰硾閻ㄦ椽鏌涢悩鏌ュ弰闁诡喚鍋撻ˇ鐗堟償閵忕姵鐎梻浣告啞濞诧箓宕滃▎鎾崇闁告稑鐡ㄩ埛鎴︽⒒閸喍绶遍柣鎺楃畺閺屾稒鎯旈姀鐘灆閻庤娲﹂崑鍕亙闂侀€炲苯澧撮柍銉︽瀹曟﹢顢欓崲澹洦鐓曢柍鈺佸暟閹冲啴鏌嶉鍡樻毈婵﹨娅ｇ划娆撳礌閳╁啯鏆版俊鐐€戦崝宀勬偋韫囨稑绀嗛柟鐑橆殔闁卞洭鏌曟径鍫濆姢妞わ富鍋勯—鍐Χ韫囨洖鍩屽┑鈥冲⒔濞撶畡lateBusinessSummary 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧鏌ｉ幇顒佹儓闁搞劌鍊块弻娑㈩敃閿濆棛顦ョ紓浣哄С閸楁娊寮诲☉銏╂晝闁挎繂妫涢ˇ銉х磼閻愵剙鍔ゆ繛纭风節瀵鏁嶉崟顏呭媰闁荤姴娲﹁ぐ鍐╂叏閺囥垺鈷戠紒瀣儥閸庡繑銇勯幋婵愭█鐎殿喖顭烽幃銏ゅ礂鐏忔牗瀚介梺璇查叄濞佳勭珶婵犲伣锝夘敋閳ь剙顫忓ú顏勫窛濠电姴鍊搁～鍛存⒑缁嬫鍎愰柟鐟版搐椤繒绱掑Ο璇差€撻梺鍏间航閸庢娊濡存繝鍥ㄢ拺闁告縿鍎辨牎闂佸湱顭堥…鐑界嵁閸儱惟闁靛／鍕杺闂備浇顫夐鏍窗濡も偓閳绘挻銈ｉ崘鈹炬嫼闂佸湱顭堝ù椋庣不閹炬番浜滈柨鏂跨仢瀹撳棝鏌?
        continue;
      }

      total += completionAmount * Number(alloc.rate);
    }

    return total;
  }

  private async findPackageOrThrow(id: number): Promise<AnnualPackageEntity> {
    const pkg = await this.packageRepo.findOne({ where: { id } });
    if (!pkg) {
      throw new NotFoundException('Package #' + id + ' not found');
    }
    return pkg;
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣椤愯姤鎱ㄥ鍡楀⒒闁绘帟妫勯埞鎴︽偐瀹曞浂鏆￠梺鎶芥敱濡啴寮诲☉銏犲嵆闁靛鍎伴懜顏堟⒑缂佹ɑ鐓ユ俊顐ｇ懄缁岃鲸绻濋崶鑸垫櫖濠电娀娼уΛ鏂啃уΔ鍛拺闁告稑顭▓鏇犫偓鍏夊亾闁归棿绀侀拑鐔兼煟閺冨倵鎷￠柡浣哥У缁绘繈妫冨☉娆樻￥闂佸憡妫冮弨杈╂崲濞戞埃鍋撳☉娆樼劷闁活厼锕︾槐鎾愁吋閸滃啳鍚悗娈垮枛椤兘骞冮姀銈呯闁绘挸绨堕崑鎾剁磼濡湱绠氬銈嗙墬缁诲啴顢旈悩瑁佸綊鎮╅棃娑樹粯闂佸疇顫夐崹鍧楀箖濞嗘挻鍊烽柛蹇擃槸娴滈箖鎮楅敐搴″缂佲偓婵犲倶鈧帒顫濋敐鍛闁诲孩顔栭崰鏍€﹂悜钘夊瀭濡わ絽鍟粻娑樏归敐鍛暈闁稿鍨跺缁樼節鎼粹€茬盎濠电偠顕滅粻鎴犲弲濠电姴锕ら悧濠囧磿婵犲洦鐓曟い鎰Т閸旀粓鏌?
   *
   * city_user 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋涢ˇ鐢稿极閹剧粯鍋愰柛鎰紦閻㈢粯淇婇悙顏勨偓鏍偋濡ゅ啰鐭欓柟鐐湽閳ь剙鎳樺濠氬Ψ閿旀儳寮虫繝鐢靛█濞佳兾涢鐐嶏綁宕妷褏锛滈梺閫炲苯澧寸€规洘甯掗埥澶娢旈崘顏嗘毎濠碉紕鍋戦崐鏍偋濡ゅ懏鍤屽Δ锝呭暙缁犳牠鏌熺€涙濡囬柡鈧懞銉ｄ簻闁哄秲鍔岄幖鎼佹煕鐎ｃ劌鐏查柡宀嬬磿娴狅箓宕滆閻忓崬顪冮妶蹇曠暢婵炲懏娲熸俊鐢稿礋椤栨鈺呮煏婢舵稑鐦滄俊顐畵濮婄儤娼幍顕呮М缂備礁顦遍幊鎾活敋閿濆棛顩烽悗锝呯仛閺咃綁姊虹紒妯荤叆闁圭⒈鍋婇悰顕€宕奸悢铏圭槇闂佹眹鍨藉褍鐡梻浣瑰濞插繘宕愬┑鍡欐殾妞ゆ牜鍎愰弫宥嗘叏濡绀冮柍褜鍓欓悘婵嬫箒闂佺粯鎸稿ù鐑藉箺閻樼粯鐓熼柟鎯ь嚟閹冲啴鏌嶇憴鍕伌鐎规洘甯掗～婵嬵敇閻愬瓨鐣奸梻鍌欐祰濡椼劎娆㈠顓狀洸闁割偅娲栭拑鐔兼煟閺冨牜妫戦柡鍡楊儔閺岋絽螖閳ь剟鎮ч崱妞绘瀺闁挎繂鎷嬪〒濠氭煏閸繈顎楁鐐村灴閺屾盯寮埀顒勫垂閻㈠憡鍋╅柣鎴ｆ绾偓闂佺粯鍔曠粔闈涱潖閸︻厾绠旈柣鏃傚帶閻愬﹦鎲告惔銊ユ辈妞ゅ繐鐗婇埛鎺懨归敐鍥╂憘闁搞倖鐟﹂幈銊ヮ潨閸垻鏆ら梺鎸庣箘閸嬬偛顕ラ崟顖氱疀妞ゆ挾鍋樺Σ鎰版⒒娴ｅ憡鎯堟繛灞傚姂瀹曚即宕卞Ο纰辨祫闂佸壊鍋侀崕鏌ユ偂閺囩喓绠鹃柟瀵稿剳閸忣剟鏌￠埀顒傜磼濡偐顔曢梺鍛婁緱閸ㄦ澘鏆╅梻渚€鈧偛鑻晶顔剧磼閻樿尙效鐎规洘娲熷畷锟犳倶缂佹ɑ銇濋柡浣瑰姍瀹曘劑顢旈崨顖氬籍濠碉紕鍋戦崐鏇犳崲閹扮増鍋嬪┑鐘叉处閸嬪倿鏌ｉ弬鍨倯闁绘挻鐟╁娲敇閵娧呮殸婵犫拃灞芥灓缂佽鲸甯￠幃顏勨枎韫囨柨顦╅梺缁樻尰濞茬喖寮婚敓鐘茬倞闁靛鍎虫导鍕⒑娴兼瑧绋绘俊鐐扮矙瀵鎮㈢喊杈ㄦ櫓闂佺厧顫曢崐妤呮偂閹炬剚娓婚柕鍫濆暙閻忣亞绱掔€ｎ偄鐏撮柨婵堝仜閳规垹鈧絽鐏氶弲鐐烘⒑閼恒儍顏埶囬鐣岀彾闁哄洢鍨洪悡鐔兼煟濡搫绾у璺哄缁辨帗鎷呯憴鍕攭閻庢鍠楅幃鍌氼嚕椤曗偓瀹曞ジ鎮㈤崫鍕闂備礁鎼ˇ顖炴偋閸℃ɑ娅犲ù鐘差儐閸嬧晠寮堕崼姘珖缁炬儳銈搁弻宥堫檨闁告挻鐟╅幃鎯р攽鐎ｎ亞顦板銈嗗笒閸婃悂鐛崼鐔虹瘈闁汇垽娼у瓭闂佹寧娲忛崐婵嗙暦椤栫儐鏁冮柨鏇楀亾婵鐓￠弻锝夊籍閸ヮ煈浠╃紒鐐劤閵堟悂寮诲鍫闂佸憡鎸鹃崰搴ㄦ偩瀹勯偊娼╅弶鍫氭櫇椤︻垳绱撴笟鍥х仯闁诲繐篓ge.cityId === user.cityId闂?
   * system_admin 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柟闂寸绾惧鏌ｉ幇顒佹儓闁搞劌鍊块弻娑㈩敃閿濆棛顦ョ紓浣哄С閸楁娊寮诲☉妯锋斀闁告洦鍋勬慨銏ゆ⒑濞茶骞楅柟鎼佺畺閹偓妞ゅ繐鐗嗙粻姘辨喐濠婂牆纾跨€广儱鎮块悷閭︾叆闁告劦浜炴闂備礁鎼張顒勬儎椤栫偑鈧線寮撮姀鈩冩珳闂佹悶鍎弲鈺呭触鐎ｎ偆绡€闁汇垽娼ф禒杈ㄤ繆椤愩垺鍋ョ€规洩绻濋獮搴ㄦ寠婢跺孩鎲伴梻浣告惈濞层垽宕硅ぐ鎺撶厑闁搞儯鍔庣弧鈧梺鍓茬厛閸嬪嫭鎱ㄩ崼銉ユ瀬闁割偆鍠嶇换鍡涙煟閹板吀绨婚柍褜鍓氬ú婊堝焵椤掍胶鈻撻柡鍛█楠炲啴鎮滈挊澶屽幐闂佸憡渚楅崣鈧柟?
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犖ч柛銉㈡櫇閸橆垶姊绘担鍛婂暈婵炶绠撳畷銏ゆ寠婢跺本娈鹃梺鍛婄懃椤﹁京寮ч埀顒勬⒒閸屾氨澧涘〒姘殜瀹曟洟骞囬悧鍫㈠幈闁诲函缍嗛崐鏍箣閻樺啿搴婂┑鐐村灟閸ㄥ綊鐛姀鈥茬箚妞ゆ牗纰嶉幆鍫熴亜椤愩垻鐏辩紒杈ㄦ尰閹峰懐绮欏▎鐐闂備胶顭堥鍐磹閺囥埄鏁嬮柨婵嗩槸闁卞洭鏌￠崶鈺佷槐闁哥偠娉涢—鍐Χ閸℃袝濠电姭鎳囬崑鎾绘⒑閸涘﹤鐏ｇ紒顔界懇楠炲啰鎹勬笟顖涘兊濡炪倖鎸炬慨鐑芥偪閸曨偀鏀芥い鏃傘€嬮弨缁樹繆閻愯埖顥夐柣锝囧厴椤㈡洟鏁冮埀顒傜矆鐎ｎ偁浜滈柟鏉垮缁嬬粯銇勯弮鈧崹鍨潖缂佹ɑ濯撮柧蹇撶畭閳ь剙锕弻锟犲川椤斿墽鐓夐梺璇″暙閸忕偓妫冨畷銊╊敇閻樺灚婢栭梻鍌欑窔濞佳団€﹂崼銉ョ閹兼番鍔嶉崑顏堟煃瑜滈崜娆撳煘閹达附鍊烽柡澶嬪灩娴犵顪冮妶搴″箹婵炲樊鍙€濡?ForbiddenException闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弮鍫熸殰闁稿鎸剧划顓炩槈濡娅ч梺娲诲幗閻熲晠寮婚悢琛″亾濞戞瑯鐒界紒鐘卞嵆閺屻倝鎮ч崼婵愬殝闂侀€涚┒閸斿矂鍩為幋锕€骞㈡繛鍛存涧濡?403闂?
   */
  private verifyCityOwnership(pkg: AnnualPackageEntity, user: RequestUserScope): void {
    // system_admin 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煕椤垵浜濋柛娆忕箻閺岀喓绱掗姀鐘崇亪缂備胶濮鹃～澶愬Φ閸曨垰绠涢柛顐ｆ礃椤庡秹姊虹粙娆惧剾濞存粠浜璇测槈閵忕姈銊╂煏韫囧﹤澧查柣婵囨礋閹鎲撮崟顒傤槰闂佺粯鎼换婵嗩嚕鐠囨祴妲堥柕蹇曞Х閻も偓闂傚倸鍊搁悧濠勭矙閹寸姷涓嶉柛娆忣槺缁犻箖鎮楀☉娆樼劷闁活厼锕︾槐鎾愁吋閸滃啳鍚悗娈垮枛椤兘骞冮姀銈呯闁绘挸绨堕崑鎾剁磼濡湱绠氬銈嗙墬缁诲啴顢旈悩瑁佸綊鎮╅棃娑樹粯闂佸疇顫夐崹鍧楀箖濞嗘挻鍊烽柛蹇擃槸娴滈箖鎮楅敐搴″缂佲偓婵犲倶鈧帒顫濋敐鍛闁诲孩顔栭崰鏍€﹂悜钘夊瀭濡わ絽鍟粻娑樏归敐鍛暈闁稿鍨跺缁樼節鎼粹€茬盎濠电偠顕滅粻鎴犲弲濠电姴锕ら悧濠囧磿婵犲洦鐓曟い鎰Т閸旀粓鏌?
    if (user.role === Role.SYSTEM_ADMIN) {
      return;
    }

    const userCityId = user.cityId;
    if (!userCityId || pkg.cityId !== userCityId) {
      throw new ForbiddenException(
        'No permission to access package: userCityId=' + (userCityId ?? 'unbound') + ', packageCityId=' + pkg.cityId,
      );
    }
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗霉閿濆浜ら柤鏉挎健瀵爼宕煎顓熺彅闂佹悶鍔嶇换鍐Φ閸曨垰鍐€妞ゆ劦婢€缁墎绱撴担鎻掍壕婵犮垼鍩栭崝鏍偂濞嗘挻鐓熼柟瀵镐紳椤忓牊鍊块柣鎰靛墰缁犻箖鎮樿箛鏃傚婵炲懎锕弻锛勪沪鐠囨彃顫囬悗娈垮枟閹告娊骞冨▎寰濆湱鈧綆浜欐竟鏇㈡⒑閸涘﹦缂氶柛搴㈠▕閹矂宕卞☉娆戝幈濡炪倖鍔楅崰鎰板闯娴煎瓨鐓曢悗锝庡亝瀹曞矂鏌ｅ☉鍗炴珝鐎规洖缍婇、娆撴偂鎼搭喗缍撴繝鐢靛Х閺佹悂宕戦悩娲绘晪婵犲﹤鎳愭稉宥夋煙閹规劦鍤欑紒鐘崇墪铻栭柨婵嗘噹閺嗘瑧鐥娑樹壕闂傚倷鑳剁划顖炲礉韫囨稑鐤炬繝濠傜墳缂嶆牜鈧箍鍎遍ˇ浼村煕閹达附鐓熼柣鏂挎啞缁舵煡鏌嶉柨瀣拹闁靛洤瀚版俊鐑芥晝閳ь剚鎱ㄩ崼銏㈢＜闁哄啫鍊搁弸搴ㄦ懚閿濆鍋犳繛鎴炲笒婢ф煡鏌￠崒妤€浜炬繝纰夌磿閸嬫垿宕愰弽褜娼栫憸鐗堝笒绾惧潡鏌熼幆鐗堫棄闁告垹濮电换娑㈠箣閻愯尙鍔伴梺绋款儐閹告悂鍩㈤幘璇插瀭妞ゆ梻鏅禍鐐电磽閸屾瑧璐伴柛鐘愁殜閹兘鍩℃笟鍥ф濡炪倖鍔х粻鎴犵不閼姐倗纾藉ù锝咁潠椤忓懐顩茬憸鐗堝笚閳锋帡鏌涚仦鐐殤濠⒀勭〒缁辨帞鈧綆鍋呭畷宀勬煙?
   */
  private validateSubmission(dto: DraftSaveRequest): void {
    if (!dto.monthNo || dto.monthNo < 1 || dto.monthNo > 12) {
      throw new BadRequestException('monthNo 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂磋閳ь剨绠撻、妤呭礋椤愩倧绱遍梻浣告啞濞诧箓宕愮€ｎ€㈡椽顢旈崟骞喚鐔嗛悹铏瑰皑閸旂喖鏌ｉ妶鍛悙闁宠鍨块、娆愭叏閹邦亞鎹曢梻浣侯焾椤戝棝骞愰幖浣哥厴闁硅揪闄勯弲顒勬煕閺囩偟浠涙い銉︽尵缁辨挻鎷呴崫鍕戯綁鏌ｉ埡濠傜仩妞ゆ洩缍侀、姘跺焵椤掆偓閻ｇ兘骞掗幊铏⒐閹峰懏娼幍顔垮厭?1-12');
    }

    if (!dto.contractRows || dto.contractRows.length === 0) {
      throw new BadRequestException('At least one contract row is required');
    }

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犖ч柛銉㈡櫇閸橆垶姊绘担鍛婂暈婵炶绠撳畷銏ゆ寠婢跺本娈鹃梺鍛婄懃椤﹁京寮ч埀顒勬⒒閸屾氨澧涘〒姘殜瀹曟洟骞囬悧鍫㈠幈闁诲函缍嗛崐鏍箣閻樺啿搴婂┑鐐村灟閸ㄥ綊鐛姀鈥茬箚闁靛牆鎳庨鎾煕閺傛寧鍤囨慨濠冩そ瀹曠兘顢橀悙鎻掝瀱婵犵數鍋涘鍓佸垝閹捐绠栭柛褎顨呴悞鍨亜閹哄棗浜鹃梺瀹狀潐閸ㄥ潡銆佸▎鎾村剹妞ゆ劦鍋傞柇顖溾偓瑙勬磸閸庢娊鍩€椤掑﹦绉甸柛鐘崇墪铻炴慨妞诲亾闁哄苯绉烽¨渚€鏌涢幘璺烘瀻妞ゎ偄绻掔槐鎺懳熺拠宸偓鎾绘⒑閸涘﹦鈽夐柨鏇樺€濆鎶藉醇閵夛腹鎷洪梺缁樻尭濞撮绮旈搹鍦＜闁绘ê纾晶鍨殽閻愭彃鏆㈡い锕€婀遍埀顒冾潐濞叉牕鐣烽鍕叀濠㈣泛谩閻斿吋鍤冮柍鍝勫€归惁鎺楁⒒閸屾艾鈧嘲霉閸ヮ剨缍栧璺猴功閺嗭附鎱ㄥ璇蹭壕濡炪們鍨烘穱娲囬崷顓涘亾濞堝灝鏋涢柟璇х磿缁參鎮㈤悡搴ｅ姦濡炪倖甯掔€氼剟鎷戦悢鍏肩叆婵犻潧妫欓崯鎺楁煛閸愩劎澧曢柣鎺戠仛閵囧嫰骞掗幋婵愪痪闂佺顑呴澶愬蓟濞戙垹鐒洪柛鎰典簼閸ｎ噣姊?
    for (const row of dto.contractRows) {
      if (row.completionAmount < 0) {
        throw new BadRequestException('Contract #' + row.contractId + ': completion amount cannot be negative');
      }
      if (row.acceptanceAmount > row.completionAmount) {
        throw new BadRequestException('Contract #' + row.contractId + ': acceptance amount cannot exceed completion amount');
      }
      if ((row.invoiceAmount ?? 0) < 0) {
        throw new BadRequestException('Contract #' + row.contractId + ': invoice amount cannot be negative');
      }
      if ((row.orderAmount ?? 0) < 0) {
        throw new BadRequestException('Contract #' + row.contractId + ': order amount cannot be negative');
      }
    }

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏犖ч柛銉㈡櫇閸橆垶姊绘担鍛婂暈婵炶绠撳畷銏ゆ寠婢跺本娈鹃梺鍛婄懃椤﹁京寮ч埀顒勬⒒閸屾氨澧涘〒姘殜瀹曟洟骞囬悧鍫㈠幈闁诲函缍嗛崐鏍箣閻樺啿搴婂┑鐐村灟閸ㄥ綊鐛姀鈥茬箚妞ゆ牗绻冮鐘裁归悩铏€愰柡宀嬬稻閹棃濮€閿濆拋妫熸俊鐐€ら崢楣冨礂濡警鍤曢悹鍥ㄧゴ濡插牓鏌曡箛濠傚⒉婵炲懎妫濋弻锝夋偐閸欏顦╅悷婊勬緲閸熸壆鍒掔拠瑁佹椽顢旈崨顏呭闂備礁鎲＄换鍌溾偓姘煎弮钘熸繝濠傛噽绾捐偐绱撴担濮戭亞绮娣囧﹪宕ｆ径濠傤潚濡ょ姷鍋炵敮鎺曠亙婵犵數濮撮崯顖氣枍閸ヮ剚鈷掑〒姘ｅ亾婵炰匠鍥佸洦绂掔€ｎ亞鐛ラ梺鍝勮癁閳ь剟寮搁弮鈧妵鍕箻閸楃偟浠鹃梺鎶芥敱閸ㄥ湱妲愰幒妤婃晬婵炴垶鐟чˇ銊モ攽閻愬弶鍣归柟鍐茬箲缁岃鲸绻濋崶鑸垫櫇闂佹寧绻傚ú锕傚礆濞戙垺鈷戠紒顖涙礃閺夊綊鏌涚€ｎ偅灏い顏勫暣婵″爼宕卞Δ鍐噯闂備胶顭堥敃銈囩礊婵犲倻鏆﹂柣銏㈩焾閻掑灚銇勯幒鎴濐仾闁抽攱鍨块弻娑樷攽閸℃浼€婵犫拃鍥︽喚闁哄本鐩獮妯兼崉閻戞鈧顪冮妶鍡樼┛缂傚秳绶氶悰顔芥償閵婏箑娈熼梺闈涱檧闂勫嫰鎮甸崘娴嬫斀闁绘﹩鍠栭悘杈ㄧ箾婢跺娲撮柡浣稿暣閺佸啴宕掑☉妯规偅闂傚倷绶￠崜娆戠矓閻㈢纾婚柍鈺佸暟缁♀偓婵犵數濮撮崐鎼侇敂椤愩倗纾奸柣妯诲灇閹寸偟鈹嶅┑鐘叉搐閻顭跨捄鐚村伐妞ゎ偄鐭傚铏光偓鍦閸ゆ瑩姊虹敮顔剧М闁绘侗鍣ｉ獮鎺懳旈埀顒傜尵瀹ュ鐓曢悘鐐插⒔閳洜绱掓０婵嗕喊婵﹤顭峰畷鎺戔枎閹搭厽袦闂備胶顢婇婊呮閺囩姴鍨濇繛鍡樻尭缁犺櫕淇婇妶鍕槮濞寸姷鍘ч—鍐Χ閸涱垳顔囬梺缁橆殔濡繈骞冮悙鍝勫瀭妞ゆ劗濮崇花濠氭⒑閻熺増鎯堟俊顐ｎ殕缁傚秹宕滆绾捐棄霉閿濆牊顏犻悽顖涚洴閺屻劌顫濋懜鐢靛幗闂佹寧绻傚ú銈夊储閹绢喗鐓欐い鏃囶潐濞呭洭鏌熸搴♀枅妤犵偞鎹囬獮鎺楀籍閸屾碍妲┑鐘殿暜缁辨洟宕戦幋锕€纾归柡宥庡幖缁犳澘螖閿濆懎鏆欑紒鎰殜楠炴牕菐椤掆偓婵¤偐绱掗埀顒勫醇閵夛妇鍘介梺闈涚箳婵敻宕悙鐑樼厓闂佸灝顑呴悘鎾煛鐏炲墽娲撮柡浣稿€婚幏鐘诲箵閹烘埈鍔€闂傚倷绀侀幖顐⑽涢銏犲瀭闁割偅娲栭拑鐔哥箾閹寸偛鐒归柛瀣崌閺佹劖鎯旈垾鑼嚬闁诲氦顫夊ú鏍儗閸岀偛钃?7 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亜顒㈡い鎰矙閺屻劑鎮㈤崫鍕戙垻鐥幑鎰靛殭妞ゎ厼娼￠幊婊堟濞戞鏇㈡⒑鏉炴壆顦︽い鎴濇喘楠炲骞栨担鍛婎棟闁荤姵浜介崝宥呪枔閹€鏀介柣鎰级閳绘洖霉濠婂嫮鐭掗柣娑卞櫍婵偓闁挎稑瀚鏇㈡⒑閻熼偊鍤熼柛瀣枛楠炲﹪宕熼鍌滎啎?
    if (dto.costRows && dto.costRows.length > 0) {
      const inputCodes = new Set(dto.costRows.map((r) => r.costCategoryCode));
      for (const code of VALID_COST_CATEGORY_CODES) {
        if (!inputCodes.has(code)) {
          throw new BadRequestException('Missing cost category: ' + code);
        }
      }
    }
  }

  /**
   * 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋涢ˇ鐢稿极瀹ュ绀嬫い鎺嶇劍椤斿洭姊绘担瑙勫仩闁稿孩妞藉畷婊冣枎閹存繍妫滈悷婊呭鐢鎮″☉姘ｅ亾楠炲灝鍔氬Δ鐘虫倐閻涱噣寮介鐔哄弮闂佸憡鍔︽禍婊堝几濞戙垺鐓涢悘鐐插⒔濞叉潙鈹戦敍鍕幋妞ゃ垺鐟╅幊锟犲Χ閸℃﹩鍞┑鐘垫暩閸嬫盯鎮洪妸褍鍨濈€光偓閳ь剛妲愰悙瀵哥瘈闁搞儜鍡樻啺闂備胶绮濠氬储瑜忕划璇差潩鏉堛劌鏋戦棅顐㈡处缁嬫垹绮诲ú顏呯厽婵☆垰鍚嬮弳鈺冪棯閹佸仮闁哄矉绲借灒闁告繂瀚В鎰版⒑鐠囪尙绠查柟鍛婂▕瀵鍨惧畷鍥ㄦ畷闁诲函缍嗛崜娑㈡儊閸儲鍊甸悷娆忓缁€鍫ユ煕閻樺磭澧摶鐐烘煕閹扳晛濡锋俊鎻掔墛閹便劌顫滈崱妞剧盎闂佺妫勯澶婎潖婵犳艾纾兼繛鍡樺姉閵堟澘顪冮妶鍡樼闁绘濮撮悾鐤亹閹烘繃鏅┑鐘诧工閹虫劙鎮為崗鑲╃闁圭偓娼欓悞褰掓煕鐎ｎ偅灏伴柕鍥у婵偓闁挎稑瀚崳顖滅磽娴ｅ搫校缂佸鍨块崺銉﹀緞婵炵偓鐎婚棅顐㈡处濡繘宕ラ崶顒佲拻闁稿本鐟чˇ锕傛煙鐠囇呯瘈妤犵偞鍔欓幃婊堟嚍閵夈儲鐣遍梻浣稿閸嬪懎煤濮椻偓瀹曟垿鍩￠崒婊咁啎閻庣懓澹婇崰鏇犺姳婵傚憡鐓冮梺鍨儏閻忔挳鏌熼鐓庢Щ闁宠姘︾粻娑㈠箼閸愌呮／闂傚倷鑳堕…鍫⑩偓娑掓櫊閵嗗啴宕ㄧ€涙鐣冲┑鐘垫暩婵挳鏁冮妶鍥ｅ亾濮樼厧鏋ょ紒顔碱煼閹瑥菐椤戣法鐩庨梻渚€娼х换鍡椢ｉ崨顓涙灁闁哄啫鐗婇悡鍐煢濡警妯堟俊顖楀亾濠电姵顔栭崰鎺楀磻閹剧粯鈷戠紓浣癸供閻掍粙鏌℃担渚劸妞ゎ厼娲﹀鍕箛椤撴稒瀚藉┑鐐存尰閸╁啴宕戦幘瀵哥濞达絽鍟垮В婵嬪Ω閳轰胶鍔﹀銈嗗笒鐎氼參鍩涢幒妤佺厱闁哄洢鍔屾禍婊勩亜韫囷絽骞橀柍?
   *
   * 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊瑜忛弳锕傛煟閵忋埄鐒剧紒鎰殜閺岀喖骞嶉纰辨毉闂佺顑戠换婵嬪蓟閺囩喓鐝舵い鏍殔娴滈箖姊虹粙娆惧剱闁瑰憡鎮傞敐鐐测攽鐎ｎ偄浜楅柟鑲╄ˉ濡狙囧箯椤愶附鐓熼幖娣€ゅ鎰箾閸欏澧辩紒杈╁仦缁绘繈宕堕妷銏犱壕濞达絿纭跺Σ鍫ユ煏韫囧ň鍋撻弬銉ヤ壕闁绘垼濮ら崐鍨箾閹寸儐浼嗛柟杈鹃檮閸?
   * - 闂傚倸鍊搁崐鎼佸磹閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞妞ゆ帒锕︾粙蹇旂節閵忥絽鐓愰柛鏃€娲滅划璇差潩閼搁潧鈧爼鏌ｉ幇顓炵祷闁抽攱姊归妵鍕煛娴ｅ摜楠囩紓浣虹帛缁诲牆螞閸愩劉妲堥柛妤冨仜婢规﹢姊绘担鑺ャ€冪紒鈧担鑲濇稑鈻庨幋鐐插簥濠电偞鍨崹鍦不閿濆棛绠鹃柛鈩冾殘缁犲啿霉閻樺搫浜圭紒杈ㄦ尰缁楃喖宕惰缁ㄨ崵绱撴担鍓叉Ц缂傚秴锕ら锝嗙節濮橆剙宓嗛梺缁樻椤ユ挾绮ｉ悙娴嬫斀闁绘劖娼欓悘鐔兼煕閵婏附銇濇い銏℃尭椤撳吋寰勭€Ｑ勫缂傚倷绶￠崹鍗灻哄Ο琛℃瀺闁告稑鐡ㄩ悡鏇炩攽閻樻彃鏆為柛濠冨姍閺屻劌鈹戦崼婵呯捕闁剧粯鐗犻弻宥堫檨闁告挾鍠栧畷娲Ψ閿曗偓缁剁偛鈹戦悙闈涗壕闁诲氦顕ч埞鎴﹀煡閸℃浠梺鍛婎焼閸曨剙寮块梺绋跨箻濡法鎹㈤崱娑欑厽闁规澘鍚€缁ㄥ鏌嶈閸撴岸鎮ч悩鑽ゅ祦闁圭増婢樼粈鍫㈡喐瀹ュ鍨傛繝闈涙储娴滄粓鏌″鍐ㄥ闁活厼鐭傞弻锝夘敇閻旂儤鍣у銈庡幖濞硷繝骞婂鍫燁棃婵炴垶锕╁鏃堟⒒娴ｄ警鐒鹃柨鏇閸掓帡顢涘☉姘ｆ敵婵犵數濮村ù鍌炲极瀹ュ棙鍙忔慨妤€妫楁晶顖炴煕婵犲骸鐏﹂柟顔挎硾椤繈宕￠悙鐗堫潟婵?10 闂?18:00闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸婂潡鏌ㄩ弮鍫熸殰闁稿鎸剧划顓炩槈濡娅ч梺娲诲幗閻熲晠寮婚悢鍛婄秶濡わ絽鍟宥夋⒑缁嬫鍎忔い鎴濐樀瀵鈽夐姀鐘靛姶闂佸憡鍔戦崝宥夊箚濞戞瑧绠鹃悗娑欘焽閻﹦绱撳鍜冭含鐎殿喖顭烽弫宥夊礋椤忓懎濯伴梺鑽ゅТ濞诧箒銇愰崘鈺傚弿闁哄洢鍨洪埛鎴犵磽娴ｅ顏嗙箔瑜忕槐鎺楊敋閸涱厾浠稿Δ鐘靛仜閻楁挻淇婇幖浣肝ㄩ幖杈剧到閺嬫盯鏌熼悡搴ｇШ闁诡垰鍊垮畷顐﹀Ψ瑜滃Σ鍝ョ磽閸屾艾鈧悂宕愰悜鑺ュ殑闁肩鐏氶崣蹇涙煟閵忕姵鍟為柛瀣儔閺岋絽螣濞嗘儳娈梺钘夊暟閸犳劗鎹㈠☉銏犵婵炲棗绻掓禒濂告⒑缂佹ɑ灏扮紒瀣灴婵℃挳骞掗幋顓熷兊闂佹寧绻傞幊宥嗙珶閺囩喍绻嗛柣鎰典簻閳ь剚娲滈埀顒佺▓閺呯娀濡撮崘顔奸唶闁靛繆妲呭鐔兼⒑閸︻厼鍔嬫い銊ユ噹铻炴慨妞诲亾闁诡喖缍婇獮渚€骞掗幋婵愮€抽梻浣虹帛閹搁箖宕伴弽褜娼栨繛宸簻娴肩娀鏌涢弴銊ユ灈妞ゅ浚鍙冨娲箰鎼淬垻锛橀梺绋匡攻缁诲牓濡存担鑲濈喖鎳￠妶澶嬵€嶇紓鍌欑椤戝牆鈻旈弴銏犵９闁绘劗鍎ら埛鎴︽煕閹邦剙绾ч柟顖氱墦閺屾稒绻濋崒銈囧悑闂佺硶鏂侀崑鎾愁渻閵堝棗绗掓い锔诲灠椤曪綁顢氶埀顒勫蓟閳ュ磭鏆嗛悗锝庡墰琚﹂梻浣筋嚃閸犳捇宕归挊澶屾殾闁靛濡囩弧鈧梺鍛婃礀閻忔俺鈪插┑鐘垫暩婵兘銆傞挊澹╋綁宕ㄩ弶鎴狅紱闂佸憡渚楅崹鎶芥儗濞嗘挻鐓欓悗鐢殿焾瀛濋悗娈垮枟瑜板啴鍩為幋锔藉亹闁割煈鍋呭В鍕節濞堝灝鏋熸繛鍏肩懅閸欏懘姊洪幐搴㈢闁稿﹥鎮傞幃?
   * - 闂傚倸鍊搁崐宄懊归崶褏鏆﹂柣銏㈩焾缁愭鏌熼柇锕€鏋涢柛銊︾箞楠炴牕菐椤掆偓閻忣亝绻涢崨顖毿ｅǎ鍥э躬婵″爼宕ㄩ鍏碱仩缂傚倷鑳舵慨鎶藉础閹惰棄钃熸繛鎴炃氬Σ鍫熸叏濡も偓閻楀﹪寮幆褉鏀介柣鎰级閸ｈ棄鈹戦悙鈺佷壕闂備礁鎼惌澶屽緤閸婄喓浜芥繝鐢靛仜濡瑩宕曢崘娴嬫灁妞ゆ挾濮风壕钘夈€掑顒佹悙濞存粍绮庣槐鎺撳緞婵犲嫮楔閻庢鍠栭…宄邦嚕閹绢喗鍋勫瀣捣閻涱喗绻濋悽闈涗沪闁割煈鍨跺畷鐟懊洪宥嗘櫅閻庡箍鍎遍ˇ浼村煕?> 闂傚倸鍊搁崐宄懊归崶褏鏆﹂柣銏㈩焾缁愭鏌熼柇锕€鏋涢柛銊︾箞楠炴牕菐椤掆偓閻忣亝绻涢崨顖毿ｅǎ鍥э躬婵″爼宕ㄩ鍏碱仩缂傚倷鑳舵慨鎶藉础閹惰棄绠栫憸鐗堝笒閻愬﹥銇勮箛鎾缎㈡繛鍫熺箞濮婃椽宕楅崗鑲╁嚒濠电偟銆嬬换婵嗩嚕鐠囧樊鍚嬮柛顐亝椤庡洭姊绘担鍛婂暈闁规悂绠栧畷浼村冀瑜滈崵鏇炩攽閻樺磭顣查柛瀣閺岋綁骞橀搹顐ｅ闯濡炪倖姊归崝鏇⑩€旈崘顔嘉ч柛鈩兠棄宥囩磽娴ｇ瓔鍤欓悗姘緲閻ｅ嘲鈻庨幘鏉戜画闂備緡鍙忛梽鍕偓闈涚焸濮婃椽妫冨☉姘暫濠碘槅鍋呴〃鍫㈠垝椤撶儐娼╅柤鍝ユ暩閸樹粙姊洪崘鍙夋儓闁挎洏鍊濋幃姗€鎮╅悙鎴掔盎?18:00 闂?闂傚倸鍊搁崐宄懊归崶褏鏆﹂柣銏㈩焾缁愭鏌熼柇锕€鏋涢柛銊︾箞楠炴牕菐椤掆偓閻忣亝绻涢崨顖毿ｅǎ鍥э躬婵″爼宕ㄩ鍏碱仩缂傚倷鑳舵慨鎶藉础閹惰棄绠栫憸鐗堝笒閻愬﹥銇勮箛鎾缎㈡繛鍫熺箞濮婃椽宕楅崗鑲╁嚒濠电偟銆嬬换婵嗩嚕鐠囧樊鍚嬮柛顐亝椤庡洭姊绘担鍛婂暈闁规悂绠栧畷浼村冀瑜滈崵鏇㈡偣閸ャ劎銈存俊鎻掔墛娣囧﹪顢涢悙瀛樻殸闂佽楠搁…宄拔涢崨鎼晝闁靛繆鈧啿浜堕梻浣侯焾鐎涒晠鎮￠敓鐘参ラ柛宀€鍋為崵鍐煃閸濆嫬鏆熼柨娑欑箖缁绘稒娼忛崜褍鍩岄梺鍦拡閸嬪﹪銆侀幘璇茬闁告挷鑳堕敍婵嬫倵楠炲灝鍔氶悗姘煎櫍钘濋柨鏇炲€归悡鐔兼煥濠靛棙鍣规俊鑼帛閵囧嫰顢樺鍐潎閻庤娲橀敃銏ょ嵁閸℃凹妲奸梺绋款煬閸ㄨ泛顫忕紒妯诲闁惧繐绠嶉埀顒€锕弻娑㈠箻鐎靛摜鐤勯梺闈涙閸熷磭绮诲☉妯锋婵☆垱妲掔欢銏ゆ⒒娴ｈ姤纭堕柛鐘虫尰閹便劑鎮界粙璺ㄥ幈闂佺鎻梽鍕偂閺囩喓绡€闂傚牊绋掗ˉ婊勩亜韫囷絽浜滄い顓″劵椤﹁櫕绻涢崣澶涜€垮┑锛勬暬瀹曠喖顢涘☉娆愮彆闂備礁鍚嬫禍浠嬪磿閹惰棄绀勯柨鐔哄У閳锋垿鏌熺粙鍨劉缁剧偓鎮傞弻娑㈠Ω閵堝洨鐓撻梺闈涙缁€渚€锝炲鍫濈劦妞ゆ帊鐒﹂崣蹇涙煃瑜滈崜鐔煎蓟閿濆憘鐔访虹拠鍙夋珱闂備礁鎽滈崑妯煎垝濞嗗浚娼栫紓浣股戞刊鎾煕濠靛嫬鍔ゅΔ鏃堟⒒娴ｄ警鐒炬い鎴濇嚇閺佸啴濡疯閻鈧箍鍎遍幊澶愬绩娴犲鍊甸柨婵嗙凹濞寸兘鏌涢埡鍐ㄤ沪缂佺粯绻堟慨鈧柨婵嗘噽閸橆偊姊洪崨濠冣拹闁绘濞€楠炲啴鍨鹃弬銉︻潔闂侀潧楠忕槐鏇㈠储閸楃儐娓婚柕鍫濇婵呯磼閼艰埖纭剁紒顔款嚙铻ｅ〒姘煎灣閸炵敻鎮峰鍐€楅摶鐐烘煕閹伴潧鏋涢柦鍐枑缁绘盯骞嬪▎蹇曚痪闂佺锕弨閬嶅Φ閸曨喚鐤€闁圭偓鍓氭禒閬嶆⒑缁嬫鍎愰柟鍛婃倐閸╃偤骞嬮敃鈧獮銏＄箾閸℃ê濮堟い鏃€娲熷缁樻媴閸濄儳楔濠碘槅鍋夊▔鏇犲垝閸喓鐟归柍褜鍓熼獮鍐ㄢ枎閹邦喚鐦堥梺鍛婂姧缂傛氨鑺辨繝姘棅妞ゆ劑鍨烘径鍕煙閸濄儱浜鹃柣妤€娴风槐鎾诲磼濮橆兘鍋撻崫銉х煋闁圭虎鍠楅弲婵嬫煏婢诡垰瀚惔濠傗攽閻愭潙鐏熼柛銊ユ贡缁鏁愭径瀣幗闂佸綊鍋婇崢鐣岀礊閹达附鈷掑璺猴功瀛濋梺瀹狀潐閸ㄥ潡寮澶婄妞ゆ劧绱曢柦鐢电磽閸屾瑧璐伴柛鐘愁殜閹兘鍩℃担鐑樻濠电偛妯婃禍婊堟倿閸偁浜滈柟鍝勭Ч濡惧嘲霉濠婂嫮鐭掗柡宀€鍠栭幃婊兾熼搹閫涙樊闂備線鈧偛鑻晶顕€鏌熺拠褏纾跨紒顔碱儏椤撳吋寰勭€ｎ亖鍋撻柨瀣ㄤ簻闁圭儤鍨甸埀顒€顭烽幆渚€宕奸妷锔规嫼?
   * - 闂傚倸鍊搁崐宄懊归崶褏鏆﹂柣銏㈩焾缁愭鏌熼柇锕€鏋涢柛銊︾箞楠炴牕菐椤掆偓閻忣亝绻涢崨顖毿ｅǎ鍥э躬婵″爼宕ㄩ鍏碱仩缂傚倷鑳舵慨鎶藉础閹惰棄钃熸繛鎴炃氬Σ鍫熸叏濡も偓閻楀﹪寮幆褉鏀介柣鎰级閸ｈ棄鈹戦悙鈺佷壕闂備礁鎼惌澶屽緤閸婄喓浜芥繝鐢靛仜濡瑩宕曢崘娴嬫灁妞ゆ挶鍨洪悡鐔煎箹濞ｎ剙鐏卞瑙勆戦妵鍕晜閻愵剚姣堥悗娈垮枦椤曆囧煡婢舵劕顫呴柍鍝勫€瑰▍鍥⒒娴ｇ懓顕滅紒璇插€哥叅闁靛ň鏅滈崑鍌炴煃瑜滈崜鐔奉潖缂佹ɑ濯撮柤鎭掑劘閳ь剙鍟撮弻锝夊箳閻愬樊娲梺鍛婂笚鐢帡鎮惧┑瀣妞ゆ劑鍊曞銊モ攽閻橆喖鐏遍柛鈺傜墵瀹曟繈寮撮悙宥嗙☉铻ｉ柤濮愬€楅鏇㈡⒑缁洖澧查柨姘舵煕閺傝鈧繈寮诲☉銏犵閻犺桨璀﹂弳顓犵磽娴ｈ櫣甯涚紒璇茬墦瀹曞搫鈽夐姀鐘靛姦濡炪倖甯掔€氼剙顔忓┑鍥ヤ簻闁规儳顕埊鏇㈡煟鎼存繂宓嗘慨濠勭帛閹峰懐绮电€ｎ亝鐣伴梻浣规偠閸斿宕￠崘鑼殾妞ゆ牜鍋涚痪褔鏌熺€电校婵炲牓绠栧铏圭磼濡儵鎷婚梺鍐插槻閻楁挸顕ｉ锕€骞㈡俊鐐存礀缂嶅﹪寮幇鏉块唶闁绘洑妞掗崫妤呮⒒娴ｅ憡鎯堟俊顐ｇ⊕閹便劑骞橀鑲╁幋闂佺鎻梽鍕磹妞嬪簶鍋撻悷鏉款棌闁哥姵鐗曢埢鎾绘嚋閻㈢數鐦堝┑鐐茬墕閻忔繈寮搁悢鍏肩厱閹艰揪绱曢弸鍐煟韫囨搩鍎旀慨濠冩そ瀹曘劍绻濋崘顭戞П闂備礁鎲￠…鍫澪涢崟顖涘仼闁绘垼妫勯拑鐔兼煏婢舵稑顩柛妯绘崌閹嘲顭ㄩ崟顓犵厜閻庤娲樼划鎾诲箖閵忋倖鍋傞幖娣€栭幉浼存⒒娴ｇ懓顕滅紒璇插€胯棟妞ゆ牗绮庢稉宥夋煙閹澘袚闁绘挻鐟╅幃妤呮偨濞堣法鍔搁悗娑欑箞濮婅櫣绱掑Ο璇叉殫闂佸摜濮甸悧鏇綖韫囨拋娲敂閸涱垰濮烽梻浣虹帛閸旀浜搁鍡忓亾濮橆厽绶叉い顓″劵椤﹂亶鏌涘Δ浣糕枙鐎殿喛顕ч埥澶婎潩閿濆懍澹曢梺鎸庣箓妤犲憡绂嶅┑瀣€堕煫鍥风到瀵噣鏌?
   * - 闂傚倸鍊搁崐宄懊归崶褏鏆﹂柣銏㈩焾缁愭鏌熼柇锕€鏋涢柛銊︾箞楠炴牕菐椤掆偓閻忣亝绻涢崨顖毿ｅǎ鍥э躬婵″爼宕ㄩ鍏碱仩缂傚倷鑳舵慨鎶藉础閹惰棄绠栫憸鐗堝笒閻愬﹥銇勮箛鎾缎㈡繛鍫熺箞濮婃椽宕楅崗鑲╁嚒濠电偟銆嬬换婵嗩嚕鐠囧樊鍚嬮柛顐亝椤庡洭姊绘担鍛婂暈闁规悂绠栧畷浼村冀瑜滈崵鏇炩攽閻樺磭顣查柡鍛倐閺岋絽螣閸喚姣㈠銈忕細閸楀啿顫忔繝姘＜婵ê宕·鈧紓鍌欑椤戝棝骞愰懡銈囩焿闁圭儤顨呴悡娑㈡煕濞戝崬鏋撻柟閿嬫そ閺岋綁鎮╅崣澶岊槺闂侀€炲苯澧痪缁㈠幗缁傛帟顦寸紒杈ㄦ尰閹峰懘鎸婃径灞藉缚闁诲骸鍘滈崑鎾剁磼鐎ｎ偒鍎ラ柛銈嗘礀閳规垿鎮╃€圭姴顥濋悗鐟版啞缁诲牓骞冨Δ鈧埥澶娾枍椤撗傞偗闁糕斁鍋撳銈嗗笒鐎氼參寮柆宥嗙厪闁搞儜鍐句純濡ょ姷鍋炵敮鎺楊敇婵傜鐐婇柤鍛婃櫕濠婂牊鈷掑ù锝堟鐢盯鎮介娑辨疁妤犵偛鍟村畷鎺戭潩閸忚偐绋佹繝鐢靛仜濡﹥绂嶅鍐惧晠婵犻潧妫岄弨浠嬫煟濡绲绘い蹇ｄ邯閺屾盯鏁愭惔鈥崇睄濠殿喖锕ㄥ▍锝囨閹烘埈娼ㄩ柛鈩冾焽閺嗭附绻濋悽闈涗哗閻忓繑鐟╁畷鐗堟償閵婏箑浠奸梻浣哥仢椤戝懘顢氶柆宥嗙厸濠㈣泛顑呴悘銉х磼閹邦厾鈽夋い顏勫暣婵″爼宕卞Ο閿嬪闂備焦鍎崇换鎰殽閸濄儱寮查梻浣哥秺濡潡鎮為敃鍌涘亗婵炲棙鎸婚悡鐘绘煕閿旇骞栨い锝堝亹閹叉悂骞庢繝鍌涘櫧缁炬儳銈稿鍫曞醇濞戞ê顬夌紓浣插亾闁割偁鍨荤壕鍏笺亜閺冨洤袚闁抽攱鍔楃槐鎺撴姜閹殿喚鐓撻悗瑙勬磸閸斿秶鎹㈠┑瀣妞ゆ劑鍨婚悿鍕⒒閸屾艾鈧嘲霉閸ヮ剨缍栧鑸靛姇绾捐法鈧娲栧ú銈壦夊顓滀簻闁规崘娉涢弸鏂款熆瑜夐埀顒佹灱閺€浠嬫煟濡椿鍟忛柡鍡樼矌缁辨帗娼忛妸锔绢槹閻庤娲橀崹鐢稿煡婢舵劕顫呴柣妯碱暜缁鳖噣姊绘担绋款棌闁绘挸鐗撳畷鎶筋敊绾拌京鍔烽梺鍝勭▉閸樹粙鎮￠悩娴嬫斀妞ゆ棁妫勬慨鍥煃瑜滈崜姘跺礉濞嗗繒鏆﹂柟杈剧畱缁犲鏌￠崒妯哄姕妞ゎ偄绉撮埞鎴︽倷閸欏娈屽┑鐐叉噺濞茬喎鐣风涵鍛汗闁圭儤鎸告禒顓㈡偡濠婂嫭鐓ユい顐㈢箳缁辨帒螣鐠囧樊鈧捇姊洪崨濠勨槈闁挎洏鍊濆鎶藉醇閵夛腹鎷虹紓鍌欑劍钃辨い銉︽閺屾盯骞樼€垫悶鈧帡鏌涢幒鎾崇瑲缂佺粯绻傞～婵嬵敆閸屻倕鎮堥梻鍌欑劍鐎笛兠哄澶婄；闁规儳澧庣壕濂告煃瑜滈崜鐔风暦閻旂⒈鏁嶆繛鎴炶壘鐢姊绘担鍝ユ瀮婵℃ぜ鍔庣划鍫熺瑹閳ь剙顕ｉ幎鑺ュ€烽悷浣疯兌閹虫捇鍩為崘顔煎瀭妞ゆ梻鎳撴禍鐐節闂堟侗鍎忛柦鍐枑缁绘盯骞嬪▎蹇曚患闁哥儐鍨跺娲箰鎼达絿鐣甸梺鐟板暱闁帮綁鍨鹃弽顓為唶闁靛鑵归幏铏圭磽閸屾瑧鍔嶉柨姘辩磼濡烇箑鎳愮壕鍏笺亜閺囩偞鍣归柣蹇ラ檮椤ㄣ儵鎮欓懠顒€鈪垫繝纰樺墲閹倹淇婇悜钘夘潊闁斥晛鍟鎴︽⒒閸屾瑧顦﹂柟娴嬧偓瓒佹椽鏁冮崒姘憋紱闂佺硶鍓濋敋妞ゆ洟浜堕弻娑㈠即閵娿儳浠梺?
   */
  private isMonthOverdue(monthNo: number): boolean {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // JS month is 0-based

    // 闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇氱秴闁搞儺鍓﹂弫鍐煥閺囨浜鹃梺姹囧€楅崑鎾舵崲濞戙垹绠ｉ柣鎰ㄦ櫆閿涘牆鈹戦悙鍙夆枙濞存粍绮屽ú鍨攽閻橆喖鐏辨繛澶嬬洴閹崇喖顢涘鍛劸闂佹寧娲栭崐褰掑煕閹达附鐓熼柣鏂挎啞缁舵煡鏌嶉柨瀣拻缂佽鲸甯￠、姘跺川椤撶姳妗撻柣搴ゎ潐濞叉ê煤閺嶎収鏁囬柛蹇曞帶缁剁偤鎮楅敐搴″妤犵偛鐗撳缁樻媴閸涘﹥鍎撳┑鐐茬湴閸ㄨ棄鐣峰┑鍫滄勃闁绘劦鍓氶悵宄邦渻閵堝棛澧紒顔兼捣婢规洘绺介崨濠勫幗濠碘槅鍨伴幖顐﹀汲闁秵鐓熼煫鍥ь儏閸旓附淇婇锛勫妽鐎垫澘瀚伴獮鍥敇閻樻彃绠哄┑鐘殿暯濡插懘宕归幎钘夊偍鐟滄柨鐣峰┑鍫氬亾閿濆骸浜栧ù婊勭矒閺屾洘寰勯崼婵嗗Ф濠德ゅ蔼濞咃絿妲愰幒鎾寸秶闁靛鍎茬拠鐐烘⒑鐠団€虫灍缂侇喗鎹囧畷娲焺閸愨晛顎撻悗鐟板閸嬪﹤螞濠婂牊鈷掗柛灞捐壘閳ь剚鎮傚畷鎰版倻閼恒儱娈戦梺鍛婃尫缁€渚€宕瑰┑鍥ヤ簻闁哄秲鍔庨惌瀣煛閸℃鐭掗柡宀€鍠栭幃婊冾潨閸℃鏆﹂梻浣侯焾椤戝懘藝椤栫偛鐓橀柟杈剧畱绾惧吋绻濇繝鍌涙崳闁告梹鎮傚铏圭磼濡櫣鐟ㄩ梺璇茬箲瀹€鍛婁繆閻㈢绀嬫い鏍ㄦ皑椤斿﹪姊洪悷鎵憼缂佹椽绠栧畷鎴﹀箻鐠囨彃绐涙繝鐢靛Т鐎氬嘲煤閹间焦鈷戠紓浣姑慨锕傛煕閹惧銆掔€殿啫鍥х劦妞ゆ帒瀚埛?
    if (monthNo < currentMonth) {
      return true;
    }

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕濡ょ姷鍋為悧鐘汇€侀弴銏℃櫆闁芥ê顦純鏇熺節閻㈤潧孝闁挎洏鍊楅埀顒佸嚬閸ｏ綁濡撮崨鏉戠煑濠㈣泛鐬奸惁鍫ユ⒒閸屾氨澧涚紒瀣浮閺佸秴顓兼径瀣幗闂佺懓鎼粔鍫曟儗濞嗘挻鐓涚€光偓鐎ｎ剛袦婵犳鍠掗崑鎾绘⒑闂堟稓绠氶柡鍛箞瀹曟繈骞栨担鍦幗闁瑰吋鐣崹鍏肩珶濡眹浜滈柨鏃傚亾閺嗩剛鈧鍠涢褔鍩ユ径鎰潊闁冲搫鍊瑰▍鍥⒒娴ｇ懓顕滅紒璇插€哥叅闁靛ň鏅滈崑鍌炴煃瑜滈崜鐔奉潖缂佹ɑ濯撮柤鎭掑劘閳ь剙鍟撮弻锝夊箳閻愬樊娲梺鍛婂笚鐢帡鎮惧┑瀣妞ゆ劑鍊曞銊モ攽閻橆喖鐏遍柛鈺傜墵瀹曟繈寮撮悩鍏哥瑝闂佺厧顫曢崐鎰板磻閹捐埖鍠嗛柛鏇ㄥ墰椤︺儱鈹戦悙宸缂佺姵甯¤棟鐟滅増甯楅悡娑㈡倶閻愬灚娅曢崯绋款渻閵囧崬鍊荤粣鏃堟煛鐏炲墽娲存鐐搭焽閳ь剟娼ч幉锟犲礆濞戙垺鍊甸悷娆忓缁€鍐煕閵娿儲鍋ラ柣娑卞枛铻ｉ柤娴嬫櫊閳瑰繒绱掔紒銏犲箹闁瑰啿顦靛畷?
    if (monthNo > currentMonth) {
      return false;
    }

    // 闂傚倸鍊搁崐宄懊归崶褏鏆﹂柣銏㈩焾缁愭鏌熼柇锕€鏋涢柛銊︾箞楠炴牕菐椤掆偓閻忣亝绻涢崨顖毿ｅǎ鍥э躬婵″爼宕ㄩ鍏碱仩缂傚倷鑳舵慨鎶藉础閹惰棄绠栫憸鐗堝笒閻愬﹥銇勮箛鎾缎㈡繛鍫熺箞濮婃椽宕楅崗鑲╁嚒濠电偟銆嬬换婵嗩嚕鐠囧樊鍚嬮柛顐亝椤庡洭姊绘担鍛婂暈闁规悂绠栧畷浼村冀瑜滈崵鏇炩攽閻樺疇澹橀幆鐔兼⒑闂堟侗妲堕柛銊︽そ閿濈偛顓奸崨顏呮杸闂佺粯鍔曞鍫曀夐悙鐑樺仺妞ゆ牗绋戝ù顕€鎸婇悢鍝ョ瘈闂傚牊渚楅崕鎰版煃闁垮鐏撮柡宀€鍠栭幊鏍煛娴ｉ鎹曞┑鐘茬棄閵堝棭浠╃紓浣介哺鐢繝銆佸▎鎾村仼閻忕偞鍎冲▍鎴炰繆閻愵亜鈧牕煤閳哄啰绀婂〒姘ｅ亾闁靛棔绀佽灃闁告侗鍘鹃ˇ浼存⒑閸撹尙鍘涢柛瀣噹閳诲秴顓兼径瀣ф嫽婵炶揪缍€濞咃絿鏁☉娆愬弿濠电姴鍊荤粔铏光偓瑙勬礃缁诲牆鐣烽妸褉鍋撳☉娅虫垵鈻嶉崶顒佲拺缂佸瀵у﹢鎵磼鐎ｎ偅宕岀€规洏鍨藉畷锟犳倷閳哄倹鏉告俊鐐€栧濠氭偂椤愶富鏁傞柛娑卞枟閻濋攱绻涚€电孝妞ゆ垵妫濆畷鎴﹀煛閸涱喒鎷哄銈嗗坊閸嬫挾绱掓径灞炬毈闁诡噯绻濆鎾閿涘嫬骞嶉梺璇插缁嬫帟鎽梺缁樻尪閸庨亶鈥﹂懗顖ｆЩ閻庢鍠栨晶搴ㄥ箲閵忕姭妲堥柕蹇娾偓鍏呯暗闂佺懓鍚嬮幆宀勫窗濮樿泛瑙﹂悗锝庡枟閸婄敻鎮峰▎蹇擃仾缂佲偓閳ь剟姊虹紒妯煎ⅹ闁告艾顑嗙粚杈ㄧ節閸パ咁啇婵炶揪缍€閸婁粙濡歌閸犳劗鈧箍鍎卞Λ娆撳矗韫囨稒鈷戦柛顭戝櫘閸庢垹绱掗埦鈧崑鎾寸節閻㈤潧浠滈柣妤€妫濋幃妯衡攽鐎ｎ亜鍤戦梺缁樻濞咃絿澹曟總鍛婄厱婵犻潧妫楅顏堟煕鐎ｃ劌鍔ら柍褜鍓濋～澶娒洪弽顐ょ濠电姴鍊婚弳锔姐亜閹板墎鐣辩紒鈧€ｎ喗鐓曟い顓熷灥娴滄粓鏌ｉ敂鐣岀煉婵﹦绮幏鍛瑹椤栨粌濮奸梻浣规た閸撴瑩濡剁粙璺ㄦ殾闁硅揪闄勯崐鐑芥煕濠靛棗顏柛姗€浜跺娲捶椤撶偛濡哄銈冨妼閹虫劙鎯€椤忓浂妯勯梺鍝勬湰閻╊垶銆侀弴銏℃櫜闁搞儮鏅濋弳銈夋⒒娴ｇ懓鈻曢柡鈧崡鐑嗘綎闁煎鍊栭～鏇㈡煙閻戞﹩娈旈柣鎺戠仛閵囧嫰骞掗幋婵愪患缂備讲鍋撻悗锝庡亖娴滄粓鏌熸导瀛樻锭濞存粍绻堥弻娑氣偓锝冨妼閸旀岸鏌嶇憴鍕伌闁诡喗鐟╁鍫曞箣閻樿鲸顢橀梻鍌欐祰瀹曠敻宕抽妷鈺佸瀭闁割偅娲栫粻鏍煟閹邦喖鍔嬮柛濠囨敱閵囧嫰骞嬪┑鍡欑◤缂備降鍔岄…宄邦潖閾忚鍠嗛柛鏇ㄥ亞椤︺劌顪冮妶鍡樼闁绘濮撮悾鐑芥濞戞帗鐎婚梺鐟邦嚟閸嬫稒绂掕箛鎾斀闁绘劕寮堕ˉ鐐烘煙閹间胶鐣虹€规洩缍侀獮妯肩磼濡厧骞堥梻渚€娼ч¨鈧紒鑼跺Г娣囧﹥绂掔€ｎ偆鍘撻梻浣哥仢椤戝懏鎱ㄦ径宀€纾?0闂?8:00闂?
    const deadline = new Date(currentYear, currentMonth - 1, DEFAULT_DEADLINE_DAY, DEFAULT_DEADLINE_HOUR, 0, 0);
    return now > deadline;
  }
}
